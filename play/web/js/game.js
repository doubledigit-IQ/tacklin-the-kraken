// Game controller: round flow and presentation timing.
// All results come from engine.js. This file only shows them.

import { Rng, prepare, newSpinOut, evalSpin, baseSpin, bonusStart, bonusSpin, describe } from './engine.js';
import { ANTIC_COLORS } from './reels.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export const BIG_WIN_TIERS = [[100, 'KRAKEN WIN!'], [40, 'MEGA WIN!'], [15, 'BIG WIN!']];

export class Game {
  constructor({ cfg, assets, sound, view, dom }) {
    this.assets = assets; this.sound = sound; this.view = view; this.dom = dom;
    this.balance = 10000;
    this.mode = 'base'; this.bonus = null;
    this.bonusBase = null;                                   // free spins: win of the feature before the spin on the reels
    this.busy = false; this.skip = false; this.turbo = false; this.auto = false;
    this.queue = [];                       // forced outcomes from the demo suite
    this.listeners = {};
    this.settings = { swapDelayMs: cfg.presentation.fishSwapDelayMs, anticipation: true, slowdown: true };
    this.lastSwapMs = null;
    this.lastBaseStops = null;
    this.seed = null;
    this.reseed(null);
    this.resetStats();
    this.setConfig(cfg);
    assets.onChange(() => { this.applyLabels(); this.renderLadder(this.bonus); this.renderFishPanel(); this.applySkin(); });
  }

  // ------------------------------------------------------------ setup
  on(evt, f) { (this.listeners[evt] = this.listeners[evt] || []).push(f); }
  emit(evt, data) { (this.listeners[evt] || []).forEach((f) => f(data)); }

  reseed(seed) {
    this.seed = seed;
    let s = seed;
    if (s === null || s === undefined || Number.isNaN(s)) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      s = a[0];
    }
    this.rng = new Rng(s >>> 0);
  }

  resetStats() {
    this.stats = { spins: 0, wagered: 0, won: 0, hits: 0, bonuses: 0, bonusWon: 0, biggest: 0, keys: 0, collects: 0 };
    this.emit('stats');
  }

  /** Load a (new) math configuration. Throws if the config is not valid. */
  setConfig(cfg) {
    const model = prepare(cfg);              // throws on errors
    this.cfg = cfg; this.model = model;
    this.outs = { base: newSpinOut(model, 'base'), bonus: newSpinOut(model, 'bonus') };
    this.names = { base: cfg.reels.base, bonus: cfg.reels.bonus };
    this.reelHasScatter = {};
    for (const set of ['base', 'bonus']) this.reelHasScatter[set] = cfg.reels[set].map((s) => s.includes(cfg.symbols.scatter));
    // values that the FISH symbols show before the first spin
    const scratch = new Rng((Math.random() * 0xffffffff) >>> 0);
    this.display = {};
    for (const [set, mode] of [['base', 'base'], ['bonus', 'level1']]) {
      const o = evalSpin(model, set, mode, scratch, null, newSpinOut(model, set));
      this.display[set] = o.fishVals.map((v) => Int32Array.from(v));
    }
    this.lastBaseStops = cfg.reels.base.map((s) => scratch.int(s.length));
    this.mode = 'base'; this.bonus = null;
    this.view.setStrips(this.names.base, this.display.base, this.lastBaseStops);
    this.dom.bet.textContent = fmt(cfg.bet);
    this.setBalance(this.balance); this.setWin(0); this.setStatus('Press SPIN to play');
    this.applyLabels();
    this.renderLadder(null); this.renderFishPanel(); this.applySkin();
    this.emit('config');
  }

  /**
   * Player-facing words. The symbol ids (KEY, FISH4 ...) never change; an art
   * set can give its own words in manifest.json ("labels"), for example a
   * trident that collects catches. Defaults: the hook and the kraken.
   */
  get L() {
    const base = {
      key: (this.cfg.presentation && this.cfg.presentation.keyLabel) || this.cfg.symbols.key,
      item: 'fish', top: 'KRAKEN', panel: 'FISH VALUES',
      fs: this.cfg.symbols.scatter,                          // the word for the scatter symbol
    };
    const set = this.assets.manifest.sets[this.assets.sel.set] || {};
    return { ...base, ...(set.labels || {}) };
  }

  get keyLabel() { return this.L.key; }

  applyLabels() {
    const L = this.L;
    const set = this.assets.manifest.sets[this.assets.sel.set] || {};
    this.sound.setTheme((set.fx || {}).audio);              // a set can have its own sounds (manifest: sets.X.fx.audio)
    this.view.anticColors = { ...ANTIC_COLORS, ...((set.fx || {}).anticColors || {}) };   // and its own glow colours
    this.dom.keyCountLabel.textContent = `${L.key}S`;
    this.dom.fishTitle.textContent = L.panel;
    this.dom.ladderNote.textContent = `3, 4 or 5 ${L.fs} symbols start the free spins. ${L.key} symbols open the next level.`;
    this.dom.fishNote.textContent = `Each ${L.key} collects the value of each ${L.item} on the reels.`;
  }

  applySkin() {
    if (this.pageTitle === undefined) this.pageTitle = document.title;
    const set = this.assets.manifest.sets[this.assets.sel.set] || {};
    document.title = set.title || this.pageTitle;            // a set can have its own name for the game (manifest: sets.X.title)
    const bg = this.assets.src(this.mode === 'bonus' ? 'bg_bonus' : 'bg_base');
    if (bg) this.dom.bg.src = bg; else this.dom.bg.removeAttribute('src');
    const logo = this.assets.src('logo');
    if (logo) { this.dom.logo.src = logo; this.dom.logoText.classList.add('hidden'); } else { this.dom.logo.removeAttribute('src'); this.dom.logoText.classList.remove('hidden'); }
  }

  // ------------------------------------------------------------ small UI helpers
  setBalance(v) { this.balance = v; this.dom.balance.textContent = fmt(v); }
  setWin(v) {
    this.winShown = v;
    this.dom.win.textContent = fmt(v);
    // free spins: the TOTAL WON meter counts with the win of the spin
    if (this.bonusBase !== null) this.dom.totalWon.textContent = fmt(this.bonusBase + Math.round(v));
  }

  /** Free spins: show the TOTAL WON meter (base = the win of the free spins before this spin), or hide it (null). */
  setBonusTotal(base) {
    this.bonusBase = base;
    this.dom.totalMeter.classList.toggle('hidden', base === null);
    this.dom.hud.classList.toggle('bonus', base !== null);
    if (base !== null) this.dom.totalWon.textContent = fmt(base);
  }
  setStatus(t) { this.dom.status.textContent = t; }

  wait(ms) {
    if (this.skip) return sleep(Math.min(ms, 20));
    const dur = ms * (this.turbo ? 0.55 : 1);
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => { if (this.skip || performance.now() - t0 >= dur) res(); else setTimeout(tick, 16); };
      tick();
    });
  }

  /** Wait until `time`; a skip request ends the wait, but not before `floor`. */
  waitUntil(time, floor) {
    return new Promise((res) => {
      const tick = () => {
        const now = performance.now();
        if (now >= time || (this.skip && now >= floor)) res(); else setTimeout(tick, 12);
      };
      tick();
    });
  }

  async countWin(from, to, ms) {
    if (to === from) return;
    const dur = this.skip ? 60 : ms * (this.turbo ? 0.6 : 1);
    const t0 = performance.now();
    let lastTick = 0; let step = 0;
    await new Promise((res) => {
      const frame = () => {
        const u = Math.min(1, (performance.now() - t0) / dur);
        this.setWin(from + (to - from) * u);
        if (performance.now() - lastTick > 70) { lastTick = performance.now(); this.sound.winTick(step++); }
        if (u < 1 && !this.skip) setTimeout(frame, 16); else { this.setWin(to); res(); }
      };
      frame();
    });
  }

  overlay(html, { button = 'CONTINUE', autoMs = 0, cls = '' } = {}) {
    const { overlay, overlayCard } = this.dom;
    overlayCard.innerHTML = html;
    const b = el('button', '', button);
    overlayCard.appendChild(b);
    overlay.className = cls;
    return new Promise((res) => {
      let done = false; let timer = null;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); overlay.className = 'hidden'; this.overlayClose = null; res(); };
      b.onclick = finish;
      this.overlayClose = finish;
      const auto = autoMs && (this.auto || this.mode === 'bonus' || cls === 'bigwin');
      if (auto) timer = setTimeout(finish, autoMs * (this.turbo ? 0.6 : 1));
    });
  }

  // ------------------------------------------------------------ panels
  renderLadder(state) {
    const rows = this.dom.ladderRows;
    rows.innerHTML = '';
    this.model.levels.forEach((lv, i) => {
      const row = el('div', 'lrow');
      const keys = state ? state.keys : 0;
      if (state && i === state.levelIndex) row.classList.add('active');
      else if (state && i < state.levelIndex) row.classList.add('done');
      else if (state && keys >= lv.keysRequired) row.classList.add('open');
      row.appendChild(el('div', 'lv', String(lv.level)));
      const req = el('div', 'req');
      req.innerHTML = i === 0 ? `<b>START</b><br>3, 4 or 5 ${this.L.fs}` : `<b>${lv.keysRequired} ${this.keyLabel}S</b><br>+${lv.spins} spins`;
      row.appendChild(req);
      row.appendChild(el('div', 'mx', `x${lv.multiplier}`));
      if (i > 0) {
        const bar = el('div', 'keybar');
        const fill = el('i');
        fill.style.width = `${Math.min(100, (100 * keys) / Math.max(1, lv.keysRequired))}%`;
        bar.appendChild(fill); row.appendChild(bar);
      }
      rows.appendChild(row);
    });
    this.dom.bonusInfo.classList.toggle('hidden', !state);
    this.dom.ladderNote.classList.toggle('hidden', !!state);
    this.dom.ladderTitle.textContent = state ? `LEVEL ${state.level}  -  x${state.multiplier}` : 'FREE SPINS LEVELS';
  }

  setBonusHud({ spinsLeft, keys, total }) {
    if (spinsLeft !== undefined) this.dom.spinsLeft.textContent = String(spinsLeft);
    if (keys !== undefined) this.dom.keyCount.textContent = String(keys);
    if (total !== undefined) this.dom.bonusWin.textContent = fmt(total);
  }

  renderFishPanel() {
    const box = this.dom.fishRows;
    box.innerHTML = '';
    for (const f of this.cfg.symbols.fish) {
      const vals = this.cfg.fish.values[f];
      const row = el('div', 'frow');
      const top = vals[vals.length - 1];
      const { key } = this.assets.keyFor(f, top);
      const src = this.assets.src(key);
      if (src) { const im = el('img'); im.src = src; im.alt = f; row.appendChild(im); } else row.appendChild(el('div', 'ph', f));
      const v = el('div', 'vals');
      v.innerHTML = `<small>${f}</small>${vals.map(fmt).join(' &middot; ')}`;
      row.appendChild(v);
      box.appendChild(row);
    }
  }

  // ------------------------------------------------------------ demo suite hooks
  queueForce(label, forced, scope) { this.queue.push({ label, forced, scope }); this.emit('queue'); }
  clearQueue() { this.queue = []; this.emit('queue'); }
  takeForced(scope) {
    const i = this.queue.findIndex((q) => q.scope === scope);
    if (i < 0) return null;
    const [q] = this.queue.splice(i, 1);
    this.emit('queue');
    return q.forced;
  }

  // ------------------------------------------------------------ input
  /** Spin button / space bar. */
  press() {
    this.sound.unlock();
    if (this.overlayClose) { this.overlayClose(); return; }
    if (this.busy) { this.skip = true; return; }
    this.spin();
  }

  setAuto(on) {
    this.auto = on;
    this.dom.btnAuto.classList.toggle('on', on);
    if (on && !this.busy) this.spin();
  }

  setTurbo(on) { this.turbo = on; this.dom.btnTurbo.classList.toggle('on', on); }

  async spin() {
    if (this.busy) return;
    if (this.balance < this.cfg.bet) { this.setStatus('Not enough credits. Add credits in the demo suite.'); this.setAuto(false); return; }
    this.busy = true; this.skip = false;
    this.dom.btnSpin.classList.add('busy');
    this.dom.btnSpin.textContent = 'SKIP';
    try {
      await this.playBaseRound();
    } catch (e) {
      console.error(e);
      this.setStatus('Error: ' + e.message);
      this.auto = false; this.dom.btnAuto.classList.remove('on');
    }
    this.busy = false; this.skip = false;
    this.dom.btnSpin.classList.remove('busy');
    this.dom.btnSpin.textContent = 'SPIN';
    this.emit('stats');
    if (this.auto) setTimeout(() => { if (this.auto && !this.busy) this.spin(); }, this.turbo ? 120 : 380);
  }

  /** Demo suite: start the free spins now, with no base spin and no bet. */
  async demoBonus(scatterCount, startLevel) {
    if (this.busy) return;
    this.busy = true; this.skip = false;
    this.dom.btnSpin.classList.add('busy');
    try {
      const total = await this.playBonus(scatterCount, { startLevel });
      this.setBalance(this.balance + total);
    } catch (e) { console.error(e); this.setStatus('Error: ' + e.message); }
    this.busy = false; this.skip = false;
    this.dom.btnSpin.classList.remove('busy');
    this.dom.btnSpin.textContent = 'SPIN';
    this.emit('stats');
  }

  // ------------------------------------------------------------ round flow
  async playBaseRound() {
    const { model, cfg } = this;
    this.setBalance(this.balance - cfg.bet);
    this.setWin(0); this.setStatus('');
    this.stats.spins++; this.stats.wagered += cfg.bet;
    const forced = this.takeForced('base');
    const r = baseSpin(model, this.rng, forced, this.outs.base);
    const d = describe(model, r.out);
    const vals = r.out.fishVals.map((v) => Int32Array.from(v));
    this.lastBaseStops = d.stops;
    await this.presentSpin('base', d, vals);
    await this.presentWins(d, r.win, { isBonus: false, mult: 1 });
    if (r.win > 0) { this.stats.hits++; this.setBalance(this.balance + r.win); }
    if (d.keyCount) this.stats.keys++;
    if (d.keyCount && d.fish.length) this.stats.collects++;
    this.stats.won += r.win;
    let roundWin = r.win;
    if (r.win >= cfg.bet * BIG_WIN_TIERS[BIG_WIN_TIERS.length - 1][0] && !r.freeSpins) await this.bigWin(r.win);
    if (r.freeSpins) {
      this.view.setWinCells(d.scatters, true);
      this.view.pop(d.scatters);
      this.setStatus(`${d.scatterCount} ${this.L.fs} SYMBOLS - FREE SPINS!`);
      this.sound.levelUp();
      this.skip = false;
      await this.wait(1100);
      const total = await this.playBonus(d.scatterCount, {});
      this.setBalance(this.balance + total);
      this.stats.won += total; this.stats.bonusWon += total;
      roundWin += total;
    }
    if (roundWin > this.stats.biggest) this.stats.biggest = roundWin;
    if (roundWin === 0 && !this.dom.status.textContent) this.setStatus('');
  }

  /** True if a KEY symbol on an earlier reel makes reel i anticipate. */
  keyAnticipation(d, i) {
    const a = this.cfg.anticipation;
    return a.keyAnticipateReels.includes(i + 1) && d.keys.some((k) => k.reel < i && a.keyTriggerReels.includes(k.reel + 1));
  }

  anticipationFor(setName, d, i) {
    const a = this.cfg.anticipation;
    const reelNo = i + 1;
    let kind = null;
    if (a.keyAnticipateReels.includes(reelNo) && d.keys.some((k) => k.reel < i && a.keyTriggerReels.includes(k.reel + 1))) kind = 'key';
    const fsBefore = d.scatters.filter((s) => s.reel < i).length;
    if (fsBefore >= a.scatterCount && this.reelHasScatter[setName][i]) kind = 'fs';
    return kind;
  }

  async presentSpin(setName, d, vals) {
    const { view, sound } = this;
    const R = this.model.reelCount;
    const t0 = performance.now();           // the wager
    view.startSpin(this.turbo);
    sound.spinStart();
    // FISH value swap: a fixed delay after the wager, while the reels spin
    const swapDelay = this.settings.swapDelayMs;
    let swapped = false;
    const doSwap = () => {
      if (swapped) return;
      swapped = true;
      view.setFishVals(vals);
      this.display[setName] = vals;
      this.lastSwapMs = performance.now() - t0;
      sound.swap();
      this.emit('swap');
    };
    const swapTimer = setTimeout(doSwap, swapDelay);
    const floor = swapDelay + 180;          // no reel stops before the swap
    const gap = this.turbo ? 110 : 260;
    const anticExtra = this.turbo ? 520 : 1100;
    const idleStatus = this.dom.status.textContent;
    let teased = false;
    let krakenMissed = false;
    let startAt = Math.max(this.turbo ? 520 : 850, floor);
    const lands = [];
    for (let i = 0; i < R; i++) {
      const kind = this.settings.anticipation ? this.anticipationFor(setName, d, i) : null;
      if (i > 0) startAt += gap;
      if (kind && !this.skip) {
        await Promise.all(lands);            // the reels before this one are at rest
        view.setAnticipation(i, kind);
        view.pop((kind === 'fs' ? d.scatters : d.keys).filter((c) => c.reel < i));   // the symbols that start this anticipation pulse
        sound.startRiser(kind);
        this.setStatus(kind === 'fs' ? 'FREE SPINS CHANCE!' : `${this.L.key} IS IN - BIG ${this.L.item.toUpperCase()} CHANCE!`);
        teased = true;
        startAt = performance.now() - t0 + anticExtra;
      }
      // slow-motion step: a hook is in and this reel can show a kraken symbol
      const slowSyms = this.cfg.anticipation.slowdownSymbols || [];
      const slowMo = kind && !this.skip && this.settings.slowdown && this.keyAnticipation(d, i)
        && this.names[setName][i].some((sym) => slowSyms.includes(sym));
      if (slowMo) startAt -= this.turbo ? 250 : 420;         // the approach run takes this time
      await this.waitUntil(t0 + startAt, t0 + floor);
      if (!swapped) { clearTimeout(swapTimer); doSwap(); }
      const land = slowMo && !this.skip
        ? view.approachReel(i, d.stops[i], {
          run: this.cfg.anticipation.slowdownRunSymbols || 18,
          slow: this.cfg.anticipation.slowdownSpeed || 2.8,
          isTarget: (sym) => slowSyms.includes(sym),
          abort: () => this.skip,
          onEvent: (evt) => {
            if (evt === 'enter') { sound.stopRiser(); sound.krakenNear(); this.setStatus(`THE ${this.L.top}...`); this.emit('slowmo', 'enter'); }
            else { sound.krakenMiss(); this.setStatus(`THE ${this.L.top} GOT AWAY!`); krakenMissed = true; this.emit('slowmo', 'pass'); }
          },
        })
        : view.stopReel(i, d.stops[i]);
      lands.push(land.then(() => {
        if (kind) { view.setAnticipation(i, null); sound.stopRiser(); }
        this.landEffects(d, i, slowSyms);
      }));
    }
    await Promise.all(lands);
    sound.stopRiser();
    if (krakenMissed) await this.wait(650);                // let the miss message show
    if (teased) this.setStatus(setName === 'bonus' ? idleStatus : '');
  }

  landEffects(d, i, slowSyms = []) {
    const { view, sound } = this;
    sound.reelStop(i);
    const big = d.fish.filter((f) => f.reel === i && slowSyms.includes(f.symbol));
    if (big.length && d.keys.some((k) => k.reel < i)) {      // the kraken is on the hook
      sound.krakenHit(); view.pop(big);
      this.setStatus(`THE ${this.L.top} IS ON THE ${this.L.key}!`);
    }
    const keys = d.keys.filter((k) => k.reel === i);
    const fs = d.scatters.filter((s) => s.reel === i);
    if (keys.length) { sound.keyLand(); view.pop(keys); }
    if (fs.length) { sound.scatterLand(d.scatters.filter((s) => s.reel <= i).length); view.pop(fs); }
    const fish = d.fish.filter((f) => f.reel === i);
    if (fish.length && d.keys.some((k) => k.reel < i)) { sound.fishLand(); view.pop(fish); }
  }

  async presentWins(d, win, ctx) {
    const { view, sound } = this;
    let shown = 0;
    if (d.wins.length) {
      const wins = d.wins.slice().sort((a, b) => b.pay - a.pay);
      const text = (w) => `${w.symbol} x${w.oak}  -  ${w.ways} ${w.ways === 1 ? 'way' : 'ways'}  -  pays ${fmt(w.pay)}`;
      if (wins.length > 1) {
        for (const w of wins.slice(0, 3)) {
          view.setWinCells(w.cells, true);
          this.setStatus(text(w));
          sound.winTick(w.oak * 3);
          await this.wait(520);
        }
      }
      const seen = new Set(); const all = [];
      wins.forEach((w) => w.cells.forEach((c) => { const k = `${c.reel},${c.row}`; if (!seen.has(k)) { seen.add(k); all.push(c); } }));
      view.setWinCells(all, true);
      this.setStatus(wins.length === 1 ? text(wins[0]) : `${wins.length} winning symbols  -  ways pays ${fmt(d.waysWin)}`);
      sound.smallWin();
      await this.countWin(shown, shown + d.waysWin, 450);
      shown += d.waysWin;
      await this.wait(380);
    }
    if (d.keyCount > 0) {
      if (d.fish.length) shown = await this.presentCollect(d, shown);
      else { view.setWinCells(d.keys, false); this.setStatus(`${this.L.key} - no ${this.L.item} to collect`); await this.wait(520); }
    }
    if (ctx.isBonus && ctx.mult > 1 && shown > 0) {
      const target = this.model.multAll ? shown * ctx.mult : d.waysWin + ctx.mult * d.fishWin;
      if (target !== shown) {
        const stamp = el('div', 'stamp', `x${ctx.mult}`);
        stamp.style.left = `${view.W / 2}px`; stamp.style.top = `${view.H / 2}px`;
        this.dom.fx.appendChild(stamp);
        stamp.getBoundingClientRect();
        stamp.classList.add('in');
        sound.multiplier();
        this.setStatus(`LEVEL MULTIPLIER x${ctx.mult}`);
        await this.wait(520);
        await this.countWin(shown, target, 520);
        shown = target;
        await this.wait(300);
        stamp.remove();
      }
    }
    if (shown !== win) console.error('presentation total differs from the engine result', shown, win);
    this.setWin(win);
  }

  /** Each KEY collects each FISH value. Returns the new shown total. */
  async presentCollect(d, shown) {
    const { view, sound } = this;
    const fx = this.dom.fx;
    const fish = d.fish.slice().sort((a, b) => a.reel - b.reel || a.row - b.row);
    view.setWinCells([...d.keys, ...fish], true);
    const K = this.L.key; const item = this.L.item;
    // a set can have its own collect style (manifest: sets.X.fx.collect)
    const left = this.assets.fxFor(this.cfg.symbols.key).collect === 'firecracker' ? await this.firecracker(d, fish) : null;
    this.setStatus(d.keyCount > 1 ? `${d.keyCount} ${K}S - each ${K} collects each ${item}!` : `${K} collects each ${item}!`);
    if (left) return this.collectTogether(d, fish, shown, left);
    let step = 0;
    for (const key of d.keys) {
      const kr = view.cellRect(key.reel, key.row);
      const total = el('div', 'chip total', '0');
      total.style.left = `${kr.cx}px`; total.style.top = `${kr.cy - 36}px`;
      fx.appendChild(total);
      view.pop([key]);
      let sum = 0;
      const arrivals = [];
      for (const f of fish) {
        const fr = view.cellRect(f.reel, f.row);
        const chip = el('div', 'chip', fmt(f.value));
        chip.style.left = `${fr.cx}px`; chip.style.top = `${fr.cy}px`;
        fx.appendChild(chip);
        if (left && left.has(f)) { left.get(f).remove(); left.delete(f); }      // the value that the fish left behind starts to move
        chip.getBoundingClientRect();        // start the CSS transition from the fish cell
        chip.style.left = `${kr.cx}px`; chip.style.top = `${kr.cy - 36}px`;
        view.pop([f]);
        arrivals.push(sleep(430).then(() => {
          chip.remove();
          sum += f.value;
          total.textContent = fmt(sum);
          sound.collect(step++);
        }));
        await this.wait(this.turbo ? 110 : 190);
      }
      await Promise.all(arrivals);
      await this.wait(260);
      total.style.top = `${view.H + 10}px`; total.style.left = `${view.W / 2}px`; total.style.opacity = '0';
      await this.countWin(shown, shown + sum, 380);
      shown += sum;
      await sleep(120);
      total.remove();
    }
    await this.wait(250);
    return shown;
  }

  /**
   * The collect of the style "firecracker": all KEY positions collect at the same moment. Each FISH value goes
   * to each KEY position at the same time, the totals count up together and go to the win together.
   * `left` = Map(fish -> the value chip that the fish left). Returns the new shown total.
   */
  async collectTogether(d, fish, shown, left) {
    const { view, sound } = this;
    const fx = this.dom.fx;
    const token = !!this.assets.extra('FX_TOKEN', this.cfg.symbols.key);
    const spots = d.keys.map((key) => {
      const kr = view.cellRect(key.reel, key.row);
      const total = el('div', 'chip total', '0');
      // with a token in the cell: the values go into the token and the total shows below it
      const to = token ? kr.cy : kr.cy - 36;
      total.style.left = `${kr.cx}px`; total.style.top = `${token ? kr.cy + view.cellH * 0.34 : kr.cy - 36}px`;
      fx.appendChild(total);
      return { key, kr, to, total, sum: 0 };
    });
    const arrivals = [];
    let step = 0;
    for (const f of fish) {
      const fr = view.cellRect(f.reel, f.row);
      if (left.has(f)) { left.get(f).remove(); left.delete(f); }                // the value that the fish left behind starts to move
      for (const s of spots) {
        const chip = el('div', 'chip', fmt(f.value));
        chip.style.left = `${fr.cx}px`; chip.style.top = `${fr.cy}px`;
        fx.appendChild(chip);
        chip.getBoundingClientRect();        // start the CSS transition from the fish cell
        chip.style.left = `${s.kr.cx}px`; chip.style.top = `${s.to}px`;
        arrivals.push(sleep(430).then(() => { chip.remove(); s.sum += f.value; s.total.textContent = fmt(s.sum); view.bumpToken(s.key.reel, s.key.row); }));
      }
      const n = step++;
      arrivals.push(sleep(430).then(() => sound.collect(n)));
      await this.wait(this.turbo ? 110 : 190);
    }
    await Promise.all(arrivals);
    await this.wait(260);
    let all = 0;
    for (const s of spots) {
      s.total.style.top = `${view.H + 10}px`; s.total.style.left = `${view.W / 2}px`; s.total.style.opacity = '0';
      all += s.sum;
    }
    await this.countWin(shown, shown + all, 380);
    shown += all;
    await sleep(120);
    spots.forEach((s) => s.total.remove());
    await this.wait(250);
    return shown;
  }

  /**
   * Collect style "firecracker": each KEY is a firecracker. The fuse burns, the firecrackers explode,
   * and the scared FISH swim off the reels. Each fish leaves its value behind; the usual collect follows.
   * Returns Map(fish -> the value chip that it left). Presentation only: the result is the engine result.
   */
  async firecracker(d, fish) {
    const { view, sound } = this;
    const fx = this.dom.fx;
    const quick = this.turbo || this.skip;
    const side = Math.min(view.cellW, view.cellH) - 6;
    const K = this.L.key;
    this.setStatus(d.keyCount > 1 ? `${d.keyCount} ${K}S ARE LIT!` : `THE ${K} IS LIT!`);
    const fuseMs = quick ? 200 : 650;
    for (const key of d.keys) {
      const c = view.cellRect(key.reel, key.row);
      view.fuse(c.cx + side * 0.17, c.cy - side * 0.3, fuseMs);     // the fuse tip of the firecracker picture
    }
    view.pop(d.keys);
    sound.fuse(fuseMs / 1000);
    await this.wait(fuseMs);
    for (const key of d.keys) {                              // the bang
      const c = view.cellRect(key.reel, key.row);
      view.hideCell(key.reel, key.row, true);
      view.burst(c.cx, c.cy);
      const token = this.assets.extra('FX_TOKEN', this.cfg.symbols.key);      // what the firecracker leaves: the values collect into it
      if (token) view.showToken(key.reel, key.row, token, quick ? 60 : 150);
    }
    view.flash('#fff6d0', 170); view.shake(quick ? 6 : 10, 330);
    sound.bang(d.keys.length);
    this.setStatus(`BANG! THE ${this.L.item.toUpperCase()} SWIM AWAY!`);
    await this.wait(quick ? 30 : 120);
    const top = this.cfg.symbols.fish[this.cfg.symbols.fish.length - 1];
    const gold = Math.max(...this.cfg.fish.values[top]);
    const left = new Map();
    const away = fish.map((f, n) => {                        // each fish swims away from the nearest firecracker
      const c = view.cellRect(f.reel, f.row);
      let kx = null;
      for (const key of d.keys) { const k = view.cellRect(key.reel, key.row); if (kx === null || Math.abs(k.cx - c.cx) < Math.abs(kx - c.cx)) kx = k.cx; }
      const dir = c.cx === kx ? (c.cx < view.W / 2 ? -1 : 1) : Math.sign(c.cx - kx);
      const tier = f.symbol.replace(/\D/g, '');
      const scared = (f.symbol === top && f.value === gold && this.assets.extra(`FX_FISH${tier}_GOLD`, f.symbol)) || this.assets.extra(`FX_FISH${tier}`, f.symbol);
      const img = scared || this.assets.img(f.symbol);       // no scared picture in this set: the plain fish
      const delay = (quick ? 20 : 55) * n;
      const dist = (dir < 0 ? c.cx : view.W - c.cx) + side;
      const wob = 6 + Math.random() * 5; const ph = Math.random() * 6.3;
      setTimeout(() => {
        view.hideCell(f.reel, f.row);
        sound.flee(n);
        const chip = el('div', 'chip', fmt(f.value));        // the value stays where the fish was
        chip.style.left = `${c.cx}px`; chip.style.top = `${c.cy}px`;
        fx.appendChild(chip); left.set(f, chip);
      }, delay);
      return view.addActor({
        img, size: side, delay, dur: quick ? 380 : 680, flip: dir > 0,       // the pictures face left
        at: (u) => {
          const start = Math.min(1, u / 0.16);               // a jump of fright, then the dash
          const go = u < 0.16 ? 0 : Math.pow((u - 0.16) / 0.84, 1.8);
          return { x: c.cx + dir * dist * go, y: c.cy - 12 * Math.sin(start * Math.PI) + wob * Math.sin(ph + u * 16) * go,
            rot: dir * 0.1 * Math.sin(ph + u * 16) * (0.3 + go), scale: 1 + 0.16 * Math.sin(start * Math.PI) };
        },
      });
    });
    await Promise.all(away);
    await this.wait(quick ? 60 : 220);
    return left;
  }

  async bigWin(amount) {
    const x = amount / this.cfg.bet;
    const tier = BIG_WIN_TIERS.find(([min]) => x >= min);
    if (!tier) return;
    this.sound.bigWin();
    this.skip = false;
    const p = this.overlay(`<h1>${tier[1]}</h1><div class="big" id="bigAmt">0</div><p>${x.toFixed(1)} x bet</p>`, { button: 'COLLECT', autoMs: 4200, cls: 'bigwin' });
    const node = this.dom.overlayCard.querySelector('#bigAmt');
    const t0 = performance.now(); const dur = 2200;
    const frame = () => {
      if (!node.isConnected) return;
      const u = Math.min(1, (performance.now() - t0) / dur);
      node.textContent = fmt(amount * (1 - Math.pow(1 - u, 3)));
      if (u < 1) setTimeout(frame, 16);
    };
    frame();
    await p;
  }

  async playBonus(scatterCount, opts) {
    const { model, view, sound } = this;
    const state = bonusStart(model, scatterCount);
    if (!state) return 0;
    if (opts.startLevel && opts.startLevel > 1) {           // demo suite only
      const li = Math.min(opts.startLevel, model.levels.length) - 1;
      const lv = model.levels[li];
      Object.assign(state, { levelIndex: li, level: lv.level, multiplier: lv.multiplier, spinsLeft: lv.spins, keys: lv.keysRequired });
    }
    this.mode = 'bonus'; this.bonus = state;
    this.stats.bonuses++;
    await this.overlay(`<h1>FREE SPINS</h1><h2>${state.spinsLeft} free spins &nbsp;-&nbsp; level ${state.level} &nbsp;x${state.multiplier}</h2>`
      + `<p>Each ${this.L.key} collects the value of each ${this.L.item}.</p><p>Collect ${this.L.key} symbols to open the next level.</p>`, { button: 'START', autoMs: 2800 });
    // bonus reels
    const scratch = new Rng((Math.random() * 0xffffffff) >>> 0);
    view.setStrips(this.names.bonus, this.display.bonus, this.names.bonus.map((s) => scratch.int(s.length)));
    this.applySkin();
    this.renderLadder(state);
    this.setBonusHud({ spinsLeft: state.spinsLeft, keys: state.keys, total: 0 });
    this.setWin(0);
    this.setBonusTotal(0);
    while (!state.done) {
      this.skip = false;
      await this.wait(320);
      const pre = { spinsLeft: state.spinsLeft, keys: state.keys, level: state.level };
      const forced = this.takeForced('bonus');
      const before = state.totalWin;
      const r = bonusSpin(model, state, this.rng, forced, this.outs.bonus);
      const d = describe(model, r.out);
      const vals = r.out.fishVals.map((v) => Int32Array.from(v));
      this.setBonusTotal(before);
      this.setWin(0);
      this.setBonusHud({ spinsLeft: pre.spinsLeft - 1 });
      this.setStatus(`FREE SPIN  -  LEVEL ${pre.level}  -  x${r.multiplier}`);
      await this.presentSpin('bonus', d, vals);
      if (d.keyCount) {
        this.setBonusHud({ keys: pre.keys + d.keyCount });
        const shownState = { ...state, levelIndex: model.levels.findIndex((l) => l.level === pre.level), level: pre.level, multiplier: r.multiplier };
        this.renderLadder(shownState);
        this.setBonusHud({ spinsLeft: pre.spinsLeft - 1, keys: pre.keys + d.keyCount });
      }
      await this.presentWins(d, r.win, { isBonus: true, mult: r.multiplier });
      this.setBonusHud({ total: state.totalWin });
      if (before + r.win !== state.totalWin) console.error('free spins total differs from the engine result', before, r.win, state.totalWin);
      this.setBonusTotal(state.totalWin);                    // the win of this spin is now in the total
      if (r.event === 'levelUp') {
        sound.levelUp();
        this.skip = false;
        await this.overlay(`<h1>LEVEL ${state.level}</h1><h2>x${state.multiplier} MULTIPLIER</h2><p>${state.keys} ${this.keyLabel} symbols. +${state.spinsLeft} free spins.</p>`,
          { button: 'CONTINUE', autoMs: 2600 });
        this.renderLadder(state);
        this.setBonusHud({ spinsLeft: state.spinsLeft, keys: state.keys });
      } else if (!r.event) await this.wait(220);
    }
    const next = model.levels[state.levelIndex + 1];
    const why = next ? `Level ${next.level} needs ${next.keysRequired} ${this.keyLabel} symbols. You have ${state.keys}.` : 'You completed the top level.';
    sound.bonusEnd();
    this.skip = false;
    const x = state.totalWin / this.cfg.bet;
    const tier = BIG_WIN_TIERS.find(([min]) => x >= min);
    await this.overlay(`<h1>${tier ? tier[1] : 'FREE SPINS COMPLETE'}</h1><div class="big">${fmt(state.totalWin)}</div><p>${x.toFixed(1)} x bet in ${state.spinsPlayed} free spins.</p><p>${why}</p>`,
      { button: 'COLLECT', autoMs: 4200, cls: tier ? 'bigwin' : '' });
    // back to the base reels
    this.mode = 'base'; this.bonus = null;
    view.setStrips(this.names.base, this.display.base, this.lastBaseStops);
    this.applySkin();
    this.renderLadder(null);
    this.setBonusTotal(null);
    this.setWin(state.totalWin);
    this.setStatus(`Free spins win ${fmt(state.totalWin)}`);
    return state.totalWin;
  }

  // ------------------------------------------------------------ paytable
  paytableHtml() {
    const { cfg, assets } = this;
    const K = this.keyLabel;
    const pic = (key, label) => { const s = assets.src(key); return s ? `<img src="${s}" alt="${label}">` : `<div class="ph">${label}</div>`; };
    const cards = cfg.symbols.pays.map((p) => {
      const row = cfg.paytable[p];
      const lines = row.map((v, i) => (v > 0 ? `${i + 1}: <b>${fmt(v)}</b>` : null)).filter(Boolean).reverse().join('<br>');
      return `<div class="card">${pic(p, p)}<div>${lines}</div></div>`;
    }).join('');
    const fishRows = cfg.symbols.fish.map((f) => `<tr><td>${f}</td><td>${cfg.fish.values[f].map(fmt).join(', ')}</td></tr>`).join('');
    const lv = cfg.freeSpins.levels.map((l) => `<tr><td>${l.level}</td><td>${l.level === 1 ? 'start' : l.keysRequired}</td><td>${l.level === 1 ? Object.values(cfg.freeSpins.triggerSpins).join(' / ') : l.spins}</td><td>x${l.multiplier}</td></tr>`).join('');
    const reelsOf = (set, sym) => {
      const list = cfg.reels[set].map((strip, i) => (strip.includes(sym) ? i + 1 : 0)).filter(Boolean);
      if (!list.length) return 'no reel';
      return (list.length === 1 ? 'reel ' : 'reels ') + list.join(', ').replace(/, (\d+)$/, ' and $1');
    };
    const trig = Object.entries(cfg.freeSpins.triggerSpins).map(([k, v]) => `${k} ${this.L.fs} = ${v} free spins`).join(', ');
    return `<button class="close">CLOSE</button><h2>PAYTABLE AND RULES</h2>
      <p>Bet: ${fmt(cfg.bet)} credits. All pays are in credits. The game has ${cfg.rows ** cfg.reelCount} ways.</p>
      <h3>WAYS PAYS (credits for each way)</h3><div class="grid">${cards}</div>
      <ul>
        <li>A way pays from reel 1 to the right. The same symbol must be on adjacent reels.</li>
        <li>Number of ways = the number of that symbol on each reel in the way, multiplied together.</li>
        <li>${pic(cfg.symbols.wild, 'WILD').replace('<img', '<img style="width:34px;height:34px;vertical-align:middle"')} WILD substitutes for all PIC and AUS symbols. In the base game, WILD is on ${reelsOf('base', cfg.symbols.wild)}.</li>
        ${cfg.reels.base[0].includes(cfg.symbols.wild) || cfg.reels.bonus[0].includes(cfg.symbols.wild)
    ? `<li>A way with only WILD symbols pays one time, as ${pic(cfg.symbols.pays[0], cfg.symbols.pays[0]).replace('<img', '<img style="width:34px;height:34px;vertical-align:middle"')} (the top symbol). For each other symbol, a paying way has one or more of that symbol.</li>` : ''}
        <li>FISH, ${K} and ${this.L.fs} symbols stop a way.</li>
      </ul>
      <h3>${K} AND ${this.L.item.toUpperCase()} VALUES</h3>
      <ul>
        <li>Each FISH symbol shows a credit value. The values change at each spin.</li>
        <li>${pic(cfg.symbols.key, K).replace('<img', '<img style="width:34px;height:34px;vertical-align:middle"')} Each ${K} symbol on the reels pays the value of each FISH symbol on the reels.</li>
        <li>${K} is on ${reelsOf('base', cfg.symbols.key)}. ${cfg.symbols.fish.slice(2).map((f) => `${f} is on ${reelsOf('base', f)}.`).join(' ')}</li>
      </ul>
      <table><tr><th>Symbol</th><th>Possible values (credits)</th></tr>${fishRows}</table>
      <h3>FREE SPINS</h3>
      <ul>
        <li>${trig}.</li>
        <li>The free spins use different reels: no WILD symbols and more FISH symbols.</li>
        <li>The game counts all ${K} symbols in the free spins.</li>
        <li>When the spins of a level are complete, the next level starts if you have sufficient ${K} symbols. If not, the free spins end.</li>
        <li>The level multiplier applies to ${cfg.freeSpins.multiplierAppliesTo === 'all' ? 'all wins' : 'fish collect wins'} of that level.</li>
      </ul>
      <table><tr><th>Level</th><th>${K} symbols (total)</th><th>Spins</th><th>Multiplier</th></tr>${lv}</table>
      <p style="color:#9db6cf">Demonstration software. No real money.</p>`;
  }
}
