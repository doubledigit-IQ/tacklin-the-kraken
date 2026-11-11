// Tacklin' the Kraken - game engine.
// Pure math. No DOM. The browser game and the Node simulator use this same file.
//
// Conventions
//   * stop s on a reel shows strip[s] .. strip[s + rows - 1] (top to bottom, cyclic)
//   * all wins are in credits; the bet is cfg.bet credits
//   * a spin draws random numbers in this order: 5 reel stops, then one value
//     for each FISH symbol on each reel strip (reel 1 to reel 5, strip order)

export const ENGINE_VERSION = '1.0.0';

// ---------------------------------------------------------------- RNG
function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }

/** xoshiro128** with splitmix32 seeding. Demo quality, deterministic. */
export class Rng {
  constructor(seed) {
    let s = (seed >>> 0);
    const sm = () => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }
  nextU32() {
    const r = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a; this.d ^= this.b; this.b ^= this.c; this.a ^= this.d;
    this.c ^= t; this.d = rotl(this.d, 11);
    return r;
  }
  /** Uniform integer in [0, n). Rejection sampling: no modulo bias. */
  int(n) {
    const limit = 4294967296 - (4294967296 % n);
    let x;
    do { x = this.nextU32(); } while (x >= limit);
    return x % n;
  }
}

// ---------------------------------------------------------------- validation
export function specialSymbols(cfg) {
  const s = cfg.symbols;
  return [...s.fish, s.key, s.wild, s.scatter];
}

/**
 * Returns { errors, warnings }.
 * errors   - the engine cannot give correct results.
 * warnings - the reel strips do not obey a design rule of the game.
 */
export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  const S = cfg.symbols;
  const specials = new Set(specialSymbols(cfg));
  const all = new Set([...S.pays, ...specials]);
  const R = cfg.reelCount;

  for (const sym of S.pays) {
    const row = cfg.paytable[sym];
    if (!Array.isArray(row) || row.length !== R) errors.push(`paytable.${sym} must have ${R} entries`);
    else if (row.some((v) => !(v >= 0))) errors.push(`paytable.${sym} has a negative or invalid pay`);
  }
  const modes = ['base', ...cfg.freeSpins.levels.map((l) => `level${l.level}`)];
  for (const mode of modes) {
    for (const f of S.fish) {
      const vals = cfg.fish.values[f];
      const w = cfg.fish.weights[mode] && cfg.fish.weights[mode][f];
      if (!Array.isArray(w) || !Array.isArray(vals) || w.length !== vals.length) {
        errors.push(`fish.weights.${mode}.${f} must have one weight for each value`);
      } else if (w.some((x) => !(Number.isInteger(x) && x >= 0)) || w.reduce((a, b) => a + b, 0) <= 0) {
        errors.push(`fish.weights.${mode}.${f} must be non-negative integers with a positive sum`);
      }
    }
  }
  const lv = cfg.freeSpins.levels;
  lv.forEach((l, i) => {
    if (l.level !== i + 1) errors.push('freeSpins.levels must be level 1, 2, 3 ... in order');
    if (i > 0 && !(l.spins >= 1)) errors.push(`level ${l.level} must have 1 or more spins`);
    if (i > 0 && l.keysRequired < lv[i - 1].keysRequired) errors.push('keysRequired must not decrease');
    if (!(l.multiplier > 0)) errors.push(`level ${l.level} multiplier must be positive`);
  });
  const trigKeys = Object.keys(cfg.freeSpins.triggerSpins).map(Number).sort((a, b) => a - b);
  trigKeys.forEach((k, i) => { if (i > 0 && k !== trigKeys[i - 1] + 1) errors.push('triggerSpins keys must be consecutive'); });
  if (!['all', 'fish'].includes(cfg.freeSpins.multiplierAppliesTo)) errors.push("multiplierAppliesTo must be 'all' or 'fish'");

  for (const setName of ['base', 'bonus']) {
    const reels = cfg.reels[setName];
    if (!Array.isArray(reels) || reels.length !== R) { errors.push(`reels.${setName} must have ${R} strips`); continue; }
    reels.forEach((strip, r) => {
      const tag = `${setName} reel ${r + 1}`;
      const n = strip.length;
      if (n < cfg.rows) errors.push(`${tag}: strip is shorter than the reel window`);
      if (n !== cfg.stripLength) warnings.push(`${tag}: ${n} symbols, design rule is ${cfg.stripLength}`);
      strip.forEach((sym, i) => {
        if (!all.has(sym)) errors.push(`${tag}: unknown symbol ${sym} at ${i}`);
        if (specials.has(sym)) {
          for (let d = 1; d <= cfg.reelRecipe.minGap; d++) {
            if (specials.has(strip[(i + d) % n])) warnings.push(`${tag}: gap rule broken at position ${i}`);
          }
          const allowed = cfg.placement[setName][sym];
          if (allowed && !allowed[r]) {
            const msg = `${tag}: ${sym} is not permitted on this reel`;
            // WILD on reel 1 and FS on bonus reels change the math model
            if ((sym === S.wild && r === 0) || (sym === S.scatter && setName === 'bonus')) errors.push(msg);
            else warnings.push(msg);
          }
        }
      });
      const maxRun = cfg.reelRecipe.maxAusRun;
      if (maxRun) {
        for (let i = 0; i < n; i++) {
          let run = 0;
          while (run <= maxRun && strip[(i + run) % n].startsWith('AUS')) run++;
          if (run > maxRun) { warnings.push(`${tag}: more than ${maxRun} AUS symbols in sequence (position ${i})`); break; }
        }
      }
      if (setName === 'base') {
        for (let i = 0; i < n; i++) {
          let c = 0;
          for (let d = 0; d < cfg.rows; d++) if (strip[(i + d) % n] === S.scatter) c++;
          if (c > 1) { warnings.push(`${tag}: two FS symbols in one window (stop ${i})`); break; }
        }
      }
    });
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// ---------------------------------------------------------------- model
/** Compile the JSON config into typed arrays. Throws if the config has errors. */
export function prepare(cfg) {
  const { errors, warnings } = validateConfig(cfg);
  if (errors.length) throw new Error('Invalid game config:\n' + errors.join('\n'));
  const S = cfg.symbols;
  const names = [...S.pays, ...S.fish, S.key, S.wild, S.scatter];
  const id = Object.fromEntries(names.map((n, i) => [n, i]));
  const nPay = S.pays.length;
  const nFish = S.fish.length;
  const model = {
    cfg, warnings, names, id,
    nSym: names.length, nPay, nFish,
    fishBase: nPay,
    KEY: id[S.key], WILD: id[S.wild], FS: id[S.scatter],
    rows: cfg.rows, reelCount: cfg.reelCount, bet: cfg.bet,
    pay: S.pays.map((p) => Int32Array.from(cfg.paytable[p])),
    levels: cfg.freeSpins.levels.map((l) => ({ ...l })),
    multAll: cfg.freeSpins.multiplierAppliesTo === 'all',
    triggerSpins: { ...cfg.freeSpins.triggerSpins },
    minTrigger: Math.min(...Object.keys(cfg.freeSpins.triggerSpins).map(Number)),
    maxTrigger: Math.max(...Object.keys(cfg.freeSpins.triggerSpins).map(Number)),
    sets: {}, modes: {},
  };
  for (const setName of ['base', 'bonus']) {
    const strips = cfg.reels[setName].map((s) => Int8Array.from(s.map((n) => id[n])));
    const fish = strips.map((strip) => {
      const pos = []; const type = [];
      strip.forEach((s, i) => { if (s >= nPay && s < nPay + nFish) { pos.push(i); type.push(s - nPay); } });
      return { pos: Int32Array.from(pos), type: Int8Array.from(type) };
    });
    model.sets[setName] = { strips, fish };
  }
  const modeNames = ['base', ...cfg.freeSpins.levels.map((l) => `level${l.level}`)];
  for (const mode of modeNames) {
    model.modes[mode] = S.fish.map((f) => {
      const values = Int32Array.from(cfg.fish.values[f]);
      const w = cfg.fish.weights[mode][f];
      const cum = new Int32Array(w.length);
      let t = 0;
      w.forEach((x, i) => { t += x; cum[i] = t; });
      return { values, cum, total: t };
    });
  }
  return model;
}

/** Scratch object for one reel set. Reuse it between spins. */
export function newSpinOut(model, setName) {
  const set = model.sets[setName];
  return {
    setName,
    stops: new Int32Array(model.reelCount),
    grid: new Int8Array(model.reelCount * model.rows),        // [reel * rows + row] = symbol id
    cnt: new Int8Array(model.reelCount * model.nSym),          // [reel * nSym + symbol] = count in window
    fishVals: set.strips.map((s) => new Int32Array(s.length)), // value of each FISH on each strip
    keyCount: 0, scatterCount: 0, fishSum: 0, fishCount: 0,
    waysWin: 0, fishWin: 0, total: 0,
    nWins: 0,
    winSym: new Int8Array(model.nPay), winOak: new Int8Array(model.nPay),
    winWays: new Int32Array(model.nPay), winPay: new Int32Array(model.nPay),
  };
}

/**
 * One reel spin: stops, FISH values, window, ways pays, KEY x FISH collect.
 * forced (optional): { stops: [..], fishPick: 'max' | 'min' } for the demo suite.
 * No level multiplier is applied here.
 */
export function evalSpin(model, setName, modeName, rng, forced, out) {
  const set = model.sets[setName];
  const mode = model.modes[modeName];
  const R = model.reelCount; const rows = model.rows; const nSym = model.nSym;
  const { KEY, WILD, FS, fishBase, nFish, nPay } = model;
  if (!out) out = newSpinOut(model, setName);

  // 1. reel stops
  for (let r = 0; r < R; r++) {
    const len = set.strips[r].length;
    const f = forced && forced.stops ? forced.stops[r] : null;
    out.stops[r] = (f === null || f === undefined) ? rng.int(len) : (((f % len) + len) % len);
  }
  // 2. a value for each FISH symbol on each reel strip
  const pick = forced ? forced.fishPick : null;
  for (let r = 0; r < R; r++) {
    const f = set.fish[r];
    const vals = out.fishVals[r];
    for (let i = 0; i < f.pos.length; i++) {
      const m = mode[f.type[i]];
      const x = rng.int(m.total);
      let j = 0;
      while (x >= m.cum[j]) j++;
      if (pick === 'max') j = m.values.length - 1;
      else if (pick === 'min') j = 0;
      vals[f.pos[i]] = m.values[j];
    }
  }
  // 3. window and symbol counts
  out.cnt.fill(0);
  let keyCount = 0; let scatter = 0; let fishSum = 0; let fishCount = 0;
  for (let r = 0; r < R; r++) {
    const strip = set.strips[r];
    const len = strip.length;
    for (let row = 0; row < rows; row++) {
      const p = (out.stops[r] + row) % len;
      const s = strip[p];
      out.grid[r * rows + row] = s;
      out.cnt[r * nSym + s]++;
      if (s === KEY) keyCount++;
      else if (s === FS) scatter++;
      else if (s >= fishBase && s < fishBase + nFish) { fishSum += out.fishVals[r][p]; fishCount++; }
    }
  }
  // 4. ways pays, left to right, WILD substitutes for PIC and AUS
  let waysWin = 0; let nWins = 0;
  for (let s = 0; s < nPay; s++) {
    let n = 0; let ways = 1;
    for (let r = 0; r < R; r++) {
      const c = out.cnt[r * nSym + s] + out.cnt[r * nSym + WILD];
      if (c === 0) break;
      ways *= c; n++;
    }
    if (n > 0) {
      const pay = model.pay[s][n - 1];
      if (pay > 0) {
        const win = pay * ways;
        waysWin += win;
        out.winSym[nWins] = s; out.winOak[nWins] = n; out.winWays[nWins] = ways; out.winPay[nWins] = win;
        nWins++;
      }
    }
  }
  out.keyCount = keyCount; out.scatterCount = scatter;
  out.fishSum = fishSum; out.fishCount = fishCount;
  out.waysWin = waysWin; out.nWins = nWins;
  // 5. each KEY collects each FISH value
  out.fishWin = fishSum * keyCount;
  out.total = waysWin + out.fishWin;
  return out;
}

// ---------------------------------------------------------------- game flow
/** Number of free spins for a scatter count, or 0 if there is no trigger. */
export function triggerSpinsFor(model, scatterCount) {
  if (scatterCount < model.minTrigger) return 0;
  return model.triggerSpins[String(Math.min(scatterCount, model.maxTrigger))];
}

export function baseSpin(model, rng, forced, out) {
  out = evalSpin(model, 'base', 'base', rng, forced, out);
  return { out, win: out.total, freeSpins: triggerSpinsFor(model, out.scatterCount) };
}

export function bonusStart(model, scatterCount) {
  const spins = triggerSpinsFor(model, scatterCount);
  if (!spins) return null;
  const lv = model.levels[0];
  return {
    scatterCount: Math.min(scatterCount, model.maxTrigger), initialSpins: spins,
    levelIndex: 0, level: lv.level, multiplier: lv.multiplier,
    spinsLeft: spins, spinsPlayed: 0, keys: 0, totalWin: 0, done: false,
  };
}

/**
 * One free spin. Mutates `state`.
 * Returns { out, win, level, multiplier, event } where event is
 * null, 'levelUp' or 'end'.
 */
export function bonusSpin(model, state, rng, forced, out) {
  if (state.done) throw new Error('bonus is complete');
  const lv = model.levels[state.levelIndex];
  out = evalSpin(model, 'bonus', `level${lv.level}`, rng, forced, out);
  const m = lv.multiplier;
  const win = model.multAll ? m * (out.waysWin + out.fishWin) : out.waysWin + m * out.fishWin;
  state.keys += out.keyCount;
  state.totalWin += win;
  state.spinsLeft--;
  state.spinsPlayed++;
  let event = null;
  if (state.spinsLeft === 0) {
    const next = model.levels[state.levelIndex + 1];
    if (next && state.keys >= next.keysRequired) {
      state.levelIndex++;
      state.level = next.level; state.multiplier = next.multiplier; state.spinsLeft = next.spins;
      event = 'levelUp';
    } else {
      state.done = true;
      event = 'end';
    }
  }
  return { out, win, level: lv.level, multiplier: m, event };
}

// ---------------------------------------------------------------- detail for the UI
/** Turn a spin result into plain objects for the presentation layer. */
export function describe(model, out) {
  const { rows, reelCount: R, names, KEY, WILD, FS, fishBase, nFish } = model;
  const set = model.sets[out.setName];
  const grid = []; const keys = []; const scatters = []; const fish = [];
  for (let r = 0; r < R; r++) {
    const col = [];
    for (let row = 0; row < rows; row++) {
      const s = out.grid[r * rows + row];
      col.push(names[s]);
      if (s === KEY) keys.push({ reel: r, row });
      else if (s === FS) scatters.push({ reel: r, row });
      else if (s >= fishBase && s < fishBase + nFish) {
        const p = (out.stops[r] + row) % set.strips[r].length;
        fish.push({ reel: r, row, symbol: names[s], value: out.fishVals[r][p] });
      }
    }
    grid.push(col);
  }
  const wins = [];
  for (let i = 0; i < out.nWins; i++) {
    const s = out.winSym[i]; const n = out.winOak[i];
    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let row = 0; row < rows; row++) {
        const g = out.grid[r * rows + row];
        if (g === s || g === WILD) cells.push({ reel: r, row });
      }
    }
    wins.push({ symbol: names[s], oak: n, ways: out.winWays[i], pay: out.winPay[i], cells });
  }
  return {
    stops: Array.from(out.stops), grid, keys, scatters, fish, wins,
    waysWin: out.waysWin, fishSum: out.fishSum, fishWin: out.fishWin, total: out.total,
    scatterCount: out.scatterCount, keyCount: out.keyCount,
  };
}
