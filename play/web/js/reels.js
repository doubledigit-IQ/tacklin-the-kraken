// Reel presentation on a canvas. The reels show the real reel strips, so the
// symbols that scroll past are the true neighbours of the stop position.

const mod = (a, n) => ((a % n) + n) % n;
const easeOutBack = (u) => { const c1 = 0.7; const c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

export class ReelView {
  constructor(canvas, assets, { reels = 5, rows = 4, cellW = 156, cellH = 124 } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.assets = assets;
    this.R = reels; this.rows = rows; this.cellW = cellW; this.cellH = cellH;
    this.W = reels * cellW; this.H = rows * cellH;
    this.scale = 1;
    this.strips = []; this.fishVals = [];
    this.reel = [];
    for (let i = 0; i < reels; i++) {
      this.reel.push({ pos: 0, state: 'idle', v: 0, t0: 0, pos0: 0, target: 0, landT0: 0, landDur: 400, D: 4, resolve: null, antic: null,
        rem: 0, zones: [], cruise: 30, slow: 3, focus: null, onEvent: null, abort: null });
    }
    this.fx = { dim: false, win: new Set(), winT0: 0, pop: new Map() };
    this.turbo = false;
    this.last = performance.now();
    this.resize(1);
    assets.onChange(() => { /* sprites are rebuilt on demand */ });
    // requestAnimationFrame drives the reels. A timer keeps the reels moving
    // (and lets a spin complete) when the browser pauses animation frames,
    // for example in a background tab.
    let lastRaf = 0;
    const loop = (now) => { lastRaf = now; this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    setInterval(() => { const now = performance.now(); if (now - lastRaf > 150) this.frame(now); }, 50);
  }

  resize(scale) {
    this.scale = Math.max(1, Math.min(3, scale));
    this.canvas.width = Math.round(this.W * this.scale);
    this.canvas.height = Math.round(this.H * this.scale);
    this.assets.sprites.clear();
  }

  /** strips: symbol names for each reel. fishVals: value of each FISH by strip position. */
  setStrips(strips, fishVals, stops) {
    this.strips = strips;
    this.fishVals = fishVals.map((v) => Int32Array.from(v));
    this.reel.forEach((r, i) => { r.pos = stops ? stops[i] : 0; r.state = 'idle'; r.antic = null; });
    this.clearFx();
  }

  /** Change the value art of every FISH symbol on the strips (the "symbol swap"). */
  setFishVals(fishVals) {
    this.fishVals = fishVals.map((v) => Int32Array.from(v));
  }

  get spinning() { return this.reel.some((r) => r.state !== 'idle'); }

  startSpin(turbo) {
    this.turbo = !!turbo;
    this.clearFx();
    const now = performance.now();
    this.reel.forEach((r, i) => {
      r.state = 'windup'; r.t0 = now + i * (turbo ? 25 : 70); r.pos0 = r.pos; r.v = 0; r.antic = null;
    });
  }

  /** Land reel i on `stop`. Resolves when the reel is at rest. */
  stopReel(i, stop) {
    const r = this.reel[i];
    return new Promise((resolve) => {
      r.target = stop; r.landT0 = performance.now(); r.landDur = this.turbo ? 300 : 420; r.D = 4;
      r.zones = []; r.focus = null;
      r.state = 'land'; r.resolve = resolve;
    });
  }

  /**
   * Slow-motion landing for an anticipating reel. The last `run` symbols
   * before the stop scroll on the true strip. When a symbol that passes
   * `isTarget` comes into the window, the reel brakes to slow motion. The
   * symbol then lands in the window or goes out at the bottom.
   * onEvent('enter' | 'pass', { lands }) reports the moments.
   * abort() === true (skip request) ends the slow motion.
   */
  approachReel(i, stop, { run = 18, slow = 2.8, isTarget, onEvent = null, abort = null } = {}) {
    const r = this.reel[i];
    const strip = this.strips[i];
    const len = strip.length;
    return new Promise((resolve) => {
      r.target = stop; r.rem = run; r.pos = stop + run;      // the jump is hidden by the motion blur
      r.cruise = this.turbo ? 44 : 34; r.slow = this.turbo ? slow * 2.3 : slow;
      r.v = r.cruise; r.focus = null; r.onEvent = onEvent; r.abort = abort;
      r.zones = [];
      strip.forEach((sym, p) => {
        if (!isTarget(sym)) return;
        const d = mod(p - stop, len);                        // row of the symbol when the reel is at rest
        if (d + 1.5 <= run) r.zones.push({ d, lands: d < this.rows, entered: false, done: false });
      });
      r.state = 'approach'; r.resolve = resolve;
    });
  }

  setAnticipation(i, kind) { this.reel[i].antic = kind; }

  clearFx() { this.fx.dim = false; this.fx.win = new Set(); this.fx.pop = new Map(); }

  /** Highlight cells [{reel,row}]; dim the others if dim = true. */
  setWinCells(cells, dim = true) {
    this.fx.win = new Set(cells.map((c) => `${c.reel},${c.row}`));
    this.fx.dim = dim;
    this.fx.winT0 = performance.now();
  }

  pop(cells) {
    const now = performance.now();
    cells.forEach((c) => this.fx.pop.set(`${c.reel},${c.row}`, now));
  }

  /** Cell rectangle in logical (unscaled) reel-area pixels. */
  cellRect(reel, row) {
    const x = reel * this.cellW; const y = row * this.cellH;
    return { x, y, w: this.cellW, h: this.cellH, cx: x + this.cellW / 2, cy: y + this.cellH / 2 };
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const V = this.turbo ? 40 : 30;
    for (let i = 0; i < this.R; i++) {
      const r = this.reel[i];
      const len = this.strips[i] ? this.strips[i].length : 1;
      if (r.state === 'windup') {
        const u = (now - r.t0) / 110;
        if (u >= 1) { r.state = 'spin'; r.v = 0; r.pos = r.pos0 + 0.22; } else if (u > 0) r.pos = r.pos0 + 0.22 * Math.sin((u * Math.PI) / 2);
      } else if (r.state === 'spin') {
        r.v = Math.min(V, r.v + 240 * dt);
        r.pos = mod(r.pos - r.v * dt, len);
      } else if (r.state === 'approach') {
        if (r.abort && r.abort()) {                          // skip: no more slow motion
          r.zones = []; r.focus = null; r.cruise = 70;
          if (r.rem > 5) r.rem = 5;
        }
        const ZONE_IN = -1.3; const BRAKE = 150;
        let target = r.cruise; let zoneNow = null;
        for (const z of r.zones) {
          if (z.done) continue;
          const row = z.d - r.rem;                           // row of the symbol now (0 = top row)
          if (row < ZONE_IN) target = Math.min(target, Math.sqrt(r.slow * r.slow + 2 * BRAKE * (ZONE_IN - row)));
          else if (z.lands || row < this.rows + 0.1) {
            zoneNow = z;
            const k = (row - 1.5) / 2.75;
            target = Math.min(target, r.slow * (1 + 0.6 * k * k));
          } else {
            z.done = true; r.focus = null;
            if (r.onEvent) r.onEvent('pass', z);
          }
        }
        if (zoneNow && !zoneNow.entered) {
          zoneNow.entered = true; r.focus = r.target + zoneNow.d;
          if (r.onEvent) r.onEvent('enter', zoneNow);
        }
        r.v = target < r.v ? Math.max(target, r.v - 600 * dt) : Math.min(target, r.v + 110 * dt);
        r.rem -= r.v * dt;
        const landRem = Math.min(4, Math.max(0.45, r.v / 11));
        if (r.rem <= landRem) {
          r.D = Math.max(0.02, r.rem);
          r.landDur = Math.min(900, Math.max(180, (r.D * 3.7 / Math.max(r.v, 0.8)) * 1000));
          r.landT0 = now; r.state = 'land';
        }
        r.pos = r.target + Math.max(0, r.rem);
      } else if (r.state === 'land') {
        const u = (now - r.landT0) / r.landDur;
        if (u >= 1) {
          r.pos = r.target; r.state = 'idle'; r.v = 0; r.focus = null;
          for (const z of r.zones) {                         // a symbol that stops just below the window
            if (z.entered && !z.lands && !z.done) { z.done = true; if (r.onEvent) r.onEvent('pass', z); }
          }
          r.zones = []; r.onEvent = null; r.abort = null;
          const done = r.resolve; r.resolve = null;
          if (done) done();
        } else {
          r.pos = r.target + r.D * (1 - easeOutBack(u));
          r.v = (r.D >= 3 && u < 0.55) ? V : 0;
        }
      }
    }
    this.draw(now);
  }

  draw(now) {
    const g = this.g; const s = this.scale;
    const { cellW, cellH, rows, R } = this;
    g.setTransform(s, 0, 0, s, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const side = Math.min(cellW, cellH) - 6;
    const px = Math.round(side * s);
    for (let i = 0; i < R; i++) {
      const strip = this.strips[i];
      const x0 = i * cellW;
      // column background
      const bgc = g.createLinearGradient(0, 0, 0, this.H);
      bgc.addColorStop(0, 'rgba(6,24,48,0.92)'); bgc.addColorStop(0.5, 'rgba(10,40,74,0.88)'); bgc.addColorStop(1, 'rgba(6,24,48,0.92)');
      g.fillStyle = bgc;
      g.fillRect(x0 + 2, 0, cellW - 4, this.H);
      if (!strip) continue;
      const r = this.reel[i];
      const len = strip.length;
      const moving = ((r.state === 'spin' || r.state === 'approach') && r.v > 14) || (r.state === 'land' && r.v > 0);
      let focusY = null;
      g.save();
      g.beginPath(); g.rect(x0, 0, cellW, this.H); g.clip();
      const base = Math.floor(r.pos);
      for (let j = -1; j <= rows; j++) {
        const idx = base + j;
        const p = mod(idx, len);
        const sym = strip[p];
        const val = sym.startsWith('FISH') ? this.fishVals[i][p] : null;
        const sprite = this.assets.sprite(sym, val, px, px);
        const cy = (idx - r.pos) * cellH + cellH / 2;
        const cx = x0 + cellW / 2;
        let scale = 1; let alpha = 1;
        if (r.state === 'idle' && j >= 0 && j < rows) {
          const key = `${i},${j}`;
          const isWin = this.fx.win.has(key);
          if (this.fx.dim && !isWin) alpha = 0.28;
          if (isWin) scale = 1 + 0.05 * Math.sin((now - this.fx.winT0) / 120);
          const pt = this.fx.pop.get(key);
          if (pt !== undefined) {
            const u = (now - pt) / 340;
            if (u < 1) scale *= 1 + 0.3 * (1 - u) * (1 - u); else this.fx.pop.delete(key);
          }
        }
        if (r.focus !== null && idx === r.focus && r.state !== 'idle') { scale = 1.14 + 0.04 * Math.sin(now / 70); focusY = cy; }
        const d = side * scale;
        if (moving) {
          g.globalAlpha = 0.32;
          g.drawImage(sprite, cx - d / 2, cy - d / 2 - cellH * 0.2, d, d);
          g.drawImage(sprite, cx - d / 2, cy - d / 2 + cellH * 0.2, d, d);
          g.globalAlpha = 0.7;
        } else g.globalAlpha = alpha;
        g.drawImage(sprite, cx - d / 2, cy - d / 2, d, d);
        g.globalAlpha = 1;
      }
      if (focusY !== null) {                                 // spotlight on the symbol in slow motion
        const a = 0.7 + 0.3 * Math.sin(now / 60);
        g.strokeStyle = `rgba(255,236,150,${a})`; g.lineWidth = 5; g.shadowColor = '#ffd65a'; g.shadowBlur = 26;
        g.beginPath(); g.roundRect(x0 + 5, focusY - cellH / 2 + 4, cellW - 10, cellH - 8, 14); g.stroke();
        g.shadowBlur = 0;
      }
      g.restore();
      // win frames
      if (r.state === 'idle') {
        for (let j = 0; j < rows; j++) {
          if (this.fx.win.has(`${i},${j}`)) {
            const a = 0.65 + 0.35 * Math.sin((now - this.fx.winT0) / 120);
            g.strokeStyle = `rgba(255,214,90,${a})`;
            g.lineWidth = 4; g.shadowColor = '#ffd65a'; g.shadowBlur = 14;
            g.beginPath(); g.roundRect(x0 + 6, j * cellH + 5, cellW - 12, cellH - 10, 12); g.stroke();
            g.shadowBlur = 0;
          }
        }
      }
      // anticipation glow
      if (r.antic) {
        const a = 0.55 + 0.45 * Math.sin(now / 70);
        const col = r.antic === 'fs' ? '190,120,255' : '255,200,60';
        const grad = g.createLinearGradient(x0, 0, x0 + cellW, 0);
        grad.addColorStop(0, `rgba(${col},${0.5 * a})`); grad.addColorStop(0.5, `rgba(${col},0.05)`); grad.addColorStop(1, `rgba(${col},${0.5 * a})`);
        g.fillStyle = grad; g.fillRect(x0, 0, cellW, this.H);
        g.strokeStyle = `rgba(${col},${a})`; g.lineWidth = 6; g.shadowColor = `rgb(${col})`; g.shadowBlur = 24;
        g.strokeRect(x0 + 3, 3, cellW - 6, this.H - 6);
        g.shadowBlur = 0;
      }
    }
    // separators
    g.fillStyle = 'rgba(255,214,90,0.35)';
    for (let i = 1; i < R; i++) g.fillRect(i * cellW - 1, 0, 2, this.H);
  }
}
