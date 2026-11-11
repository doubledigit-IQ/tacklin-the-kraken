// Demo suite: find reel stops that give a wanted outcome.
// A scenario gives a test for each reel window and a test for the whole spin.
// The search picks random stops that pass the reel tests, then keeps the first
// combination that passes the spin test (evaluated with the real engine).

import { Rng, evalSpin, newSpinOut } from './engine.js';

export function createForcer(model) {
  const rng = new Rng((Math.random() * 0xffffffff) >>> 0);
  const outs = { base: newSpinOut(model, 'base'), bonus: newSpinOut(model, 'bonus') };
  const names = model.names;
  const windows = {};
  for (const set of ['base', 'bonus']) {
    windows[set] = model.sets[set].strips.map((strip) => {
      const w = [];
      for (let s = 0; s < strip.length; s++) {
        const a = [];
        for (let d = 0; d < model.rows; d++) a.push(names[strip[(s + d) % strip.length]]);
        w.push(a);
      }
      return w;
    });
  }
  const has = (sym) => (w) => w.includes(sym);
  const hasAny = (...syms) => (w) => syms.some((s) => w.includes(s));
  const not = (f) => (w) => !f(w);
  const reelsWith = (set, sym) => windows[set].map((ws, i) => (ws.some(has(sym)) ? i : -1)).filter((i) => i >= 0);
  const onScreen = (out, sym) => { let c = 0; const id = model.id[sym]; for (let r = 0; r < model.reelCount; r++) c += out.cnt[r * model.nSym + id]; return c; };

  function find(set, reelTests, spinTest, mode, tries = 40000) {
    const cands = windows[set].map((ws, i) => {
      const t = reelTests[i];
      if (Array.isArray(t)) return t;                        // explicit list of stops
      const list = [];
      ws.forEach((w, s) => { if (!t || t(w)) list.push(s); });
      return list;
    });
    if (cands.some((c) => c.length === 0)) return null;
    const out = outs[set];
    for (let n = 0; n < tries; n++) {
      const stops = cands.map((c) => c[rng.int(c.length)]);
      evalSpin(model, set, mode, rng, { stops }, out);
      if (!spinTest || spinTest(out)) return stops;
    }
    return null;
  }

  function pickReels(list, n) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n).sort((x, y) => x - y);
  }

  const R = model.reelCount;
  const S = model.cfg.symbols;
  const noTrigger = (o) => o.scatterCount < model.minTrigger;

  const scenarios = {
    // ---------------- base game
    fs(n) {
      const able = reelsWith('base', S.scatter);
      if (able.length < n) return null;
      const chosen = pickReels(able, n);
      const tests = Array.from({ length: R }, (_, i) => (chosen.includes(i) ? has(S.scatter) : not(has(S.scatter))));
      return find('base', tests, (o) => o.scatterCount === n, 'base');
    },
    fsTease() {
      const able = reelsWith('base', S.scatter);
      const chosen = able.slice(0, 2);
      const tests = Array.from({ length: R }, (_, i) => (chosen.includes(i) ? has(S.scatter) : not(has(S.scatter))));
      return find('base', tests, (o) => o.scatterCount === 2 && o.keyCount === 0, 'base');
    },
    // KEY can be on more than one reel: the scenario puts it on `count` of them
    keyFish(set = 'base', mode = 'base') {
      const kr = pickReels(reelsWith(set, S.key), 1);
      const tests = Array.from({ length: R }, (_, i) => (kr.includes(i) ? has(S.key) : not(hasAny(S.key, 'FISH3', 'FISH4'))));
      return find(set, tests, (o) => o.keyCount === 1 && o.fishCount >= 2 && noTrigger(o), mode);
    },
    keyFish3(set = 'base', mode = 'base') {
      const kr = pickReels(reelsWith(set, S.key), 1);
      const fr = reelsWith(set, 'FISH3');
      const tests = Array.from({ length: R }, (_, i) => (kr.includes(i) ? has(S.key) : fr.includes(i) ? has('FISH3') : not(hasAny(S.key, 'FISH4'))));
      return find(set, tests, (o) => o.keyCount === 1 && onScreen(o, 'FISH3') >= 1 && noTrigger(o), mode);
    },
    keyFish4(set = 'base', mode = 'base') {
      const kr = pickReels(reelsWith(set, S.key), 1);
      const fr = reelsWith(set, 'FISH4');
      const tests = Array.from({ length: R }, (_, i) => (kr.includes(i) ? has(S.key) : fr.includes(i) ? has('FISH4') : not(has(S.key))));
      return find(set, tests, (o) => o.keyCount === 1 && onScreen(o, 'FISH4') >= 1 && noTrigger(o), mode);
    },
    /** KEY lands; the kraken passes through the window of its reel and ends `below` rows under it. */
    krakenMiss(set = 'base', mode = 'base', below = 0) {
      const kr = pickReels(reelsWith(set, S.key), 1);
      const tests = Array.from({ length: R }, (_, i) => (kr.includes(i) ? has(S.key) : not(has(S.key))));
      model.sets[set].strips.forEach((strip, i) => {
        const stops = [];
        strip.forEach((id, p) => { if (names[id] === 'FISH4') stops.push((((p - model.rows - below) % strip.length) + strip.length) % strip.length); });
        if (stops.length) tests[i] = stops;
      });
      return find(set, tests, (o) => o.keyCount === 1 && onScreen(o, 'FISH4') === 0 && noTrigger(o), mode);
    },
    keyTease(set = 'base', mode = 'base') {
      const kr = pickReels(reelsWith(set, S.key), 1);
      const fishFree = not(hasAny(...S.fish));
      const tests = Array.from({ length: R }, (_, i) => (kr.includes(i) ? has(S.key) : (w) => fishFree(w) && !w.includes(S.key)));
      return find(set, tests, (o) => o.keyCount === 1 && o.fishCount === 0 && o.scatterCount < 2, mode);
    },
    /** `count` KEY symbols in one spin (2 or 3), with fish to collect. */
    multiKey(set = 'bonus', mode = 'level1', count = 2) {
      const able = reelsWith(set, S.key);
      if (able.length < count) return null;
      const kr = pickReels(able, count);
      const tests = Array.from({ length: R }, (_, i) => (kr.includes(i) ? has(S.key) : not(has(S.key))));
      return find(set, tests, (o) => o.keyCount === count && o.fishCount >= 1 && noTrigger(o), mode);
    },
    noKey(set = 'bonus', mode = 'level1') {
      const tests = Array.from({ length: R }, () => not(has(S.key)));
      return find(set, tests, (o) => o.keyCount === 0, mode);
    },
    bigWays(set = 'base', mode = 'base') {
      const top = S.pays[0];
      const tests = Array.from({ length: R }, (_, i) => (i === 0 ? has(top) : hasAny(top, S.wild)));
      return find(set, tests, (o) => o.waysWin >= model.bet * 5 && noTrigger(o) && o.keyCount === 0, mode)
        || find(set, tests, noTrigger, mode);
    },
    smallWays(set = 'base', mode = 'base') {
      return find(set, [], (o) => o.waysWin > 0 && o.waysWin <= model.bet * 2 && o.keyCount === 0 && o.scatterCount < 2, mode);
    },
    dead(set = 'base', mode = 'base') {
      return find(set, [], (o) => o.total === 0 && o.scatterCount < 2 && o.keyCount === 0, mode);
    },
  };

  return {
    /** Returns { stops } for a named scenario, or null if no stops are found. */
    get(name, ...args) {
      const f = scenarios[name];
      if (!f) return null;
      const stops = f(...args);
      return stops ? { stops } : null;
    },
    names: Object.keys(scenarios),
  };
}
