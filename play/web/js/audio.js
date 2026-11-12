// Small WebAudio synthesiser. No audio files. Starts on the first user gesture.
// An art set can have its own sounds: a sound theme (manifest: sets.X.fx.audio) replaces the usual sounds.

// Pentatonic scale (do re mi sol la): note k above `base`; 5 notes for each octave.
const PENTA = [0, 2, 4, 7, 9];
const penta = (k, base = 523.25) => base * Math.pow(2, (12 * Math.floor(k / 5) + PENTA[((k % 5) + 5) % 5]) / 12);

// The sounds that a theme can replace.
const THEMED = ['spinStart', 'reelStop', 'fishLand', 'keyLand', 'scatterLand', 'swap', 'winTick', 'collect', 'smallWin', 'multiplier',
  'levelUp', 'bigWin', 'bonusEnd', 'krakenNear', 'krakenMiss', 'krakenHit', 'click', 'bang', 'startRiser'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.riserNodes = null;
    this.rollBus = null;
    this.theme = null;
    this.base = {};                                          // the usual sounds, for a theme that adds to one of them
    for (const name of THEMED) {
      const usual = this[name].bind(this);
      this.base[name] = usual;
      this[name] = (...args) => {
        const t = THEMES[this.theme];
        return t && t[name] ? t[name].apply(this, args) : usual(...args);
      };
    }
  }

  /** Select the sound theme of an art set (null = the usual sounds). */
  setTheme(name) {
    const next = THEMES[name] ? name : null;
    if (next !== this.theme) { this.stopRiser(); this.theme = next; }
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stopRiser();
  }

  tone(freq, dur, { type = 'sine', gain = 0.5, delay = 0, slide = 0, out = null } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { gain = 0.3, delay = 0, freq = 900, type = 'lowpass', out = null } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(out || this.master);
    src.start(t);
  }

  // ---- instruments for the sound themes ----
  /** Plucked string (guzheng): a sharp attack, the pitch settles from a little above, the high partials end first. */
  pluck(freq, dur = 0.5, { gain = 0.3, delay = 0, bend = 1.03 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]].forEach(([m, type, a]) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq * m * bend, t);
      o.frequency.exponentialRampToValueAtTime(freq * m, t + 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / m);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    });
  }

  /**
   * Gong: partials that are not harmonic and that grow after the stroke. size 0 = small gong (short, the pitch
   * rises), size 1 = large gong (long, the pitch falls).
   */
  gong(size = 1, { gain = 0.5, delay = 0, out = null } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const base = 330 - 190 * size;
    const dur = 1.2 + 2.4 * size;
    const glide = size < 0.5 ? 1.12 : 0.93;
    [[1, 1], [1.51, 0.55], [2.02, 0.5], [2.76, 0.32], [3.47, 0.22], [4.3, 0.16], [5.43, 0.1]].forEach(([m, a], i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * m, t);
      o.frequency.exponentialRampToValueAtTime(base * m * glide, t + 0.5);
      const peak = gain * a;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * (i ? 0.5 : 1), t + 0.008);
      if (i) g.gain.exponentialRampToValueAtTime(peak, t + 0.06 + 0.04 * i);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + 0.25 * i));
      o.connect(g); g.connect(out || this.master);
      o.start(t); o.stop(t + dur + 0.05);
    });
    this.noise(0.12, { gain: gain * 0.5, freq: 2500 + 1500 * (1 - size), delay, out });  // the stroke of the mallet
  }

  /** Drum (tanggu): a low tone that falls, and the stroke on the skin. */
  drum(freq = 90, { gain = 0.7, delay = 0, dur = 0.28, out = null } = {}) {
    this.tone(freq * 1.6, dur, { type: 'sine', gain, delay, slide: 0.6, out });
    this.noise(0.05, { gain: gain * 0.5, freq: 900, delay, out });
  }

  /** Woodblock: a short dry tick. */
  block(freq = 1100, { gain = 0.3, delay = 0, out = null } = {}) {
    this.tone(freq, 0.05, { type: 'sine', gain, delay, out });
    this.tone(freq * 2.4, 0.03, { type: 'square', gain: gain * 0.25, delay, out });
  }

  /** Small cymbals: a bright crash. */
  cymbal({ gain = 0.25, delay = 0, dur = 0.4 } = {}) {
    this.noise(dur, { gain, freq: 5200, type: 'highpass', delay });
    [2637, 3729, 4435].forEach((f) => this.tone(f, dur * 0.6, { type: 'square', gain: gain * 0.07, delay }));
  }

  spinStart() { this.tone(180, 0.18, { type: 'triangle', gain: 0.25, slide: 2.2 }); }
  reelStop(i) { this.noise(0.09, { gain: 0.5, freq: 500 }); this.tone(110 + i * 8, 0.09, { type: 'square', gain: 0.12 }); }
  fishLand() { this.tone(660, 0.08, { type: 'sine', gain: 0.18, slide: 1.4 }); }
  keyLand() { [988, 1319, 1976].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.3, delay: i * 0.06 })); }
  scatterLand(n) { const base = 392 * Math.pow(1.26, n - 1); [1, 1.5, 2].forEach((m, i) => this.tone(base * m, 0.4, { type: 'sawtooth', gain: 0.16, delay: i * 0.05 })); }
  swap() { this.tone(1200, 0.12, { type: 'sine', gain: 0.1, slide: 1.8 }); }
  winTick(step) { this.tone(520 * Math.pow(1.06, Math.min(step, 24)), 0.07, { type: 'square', gain: 0.1 }); }
  collect(step) { this.tone(700 * Math.pow(1.09, Math.min(step, 16)), 0.12, { type: 'triangle', gain: 0.28 }); }
  smallWin() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', gain: 0.22, delay: i * 0.07 })); }
  multiplier() { this.tone(300, 0.5, { type: 'sawtooth', gain: 0.22, slide: 3 }); }
  levelUp() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.3, delay: i * 0.09 })); }
  bigWin() { [392, 523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.28, { type: 'sawtooth', gain: 0.18, delay: i * 0.11 })); }
  bonusEnd() { [784, 659, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.25, delay: i * 0.12 })); }
  /** The kraken comes into view: low growl and two heartbeats. */
  krakenNear() {
    this.tone(62, 1.3, { type: 'sawtooth', gain: 0.3, slide: 0.8 });
    this.tone(93, 1.3, { type: 'triangle', gain: 0.2, slide: 0.8 });
    [0, 0.42, 0.84].forEach((t) => { this.tone(55, 0.16, { type: 'sine', gain: 0.5, delay: t }); this.tone(48, 0.2, { type: 'sine', gain: 0.4, delay: t + 0.13 }); });
  }
  krakenMiss() { this.tone(420, 0.55, { type: 'sawtooth', gain: 0.2, slide: 0.25 }); this.noise(0.35, { gain: 0.25, freq: 700 }); }
  krakenHit() {
    this.noise(0.5, { gain: 0.5, freq: 300 });
    [98, 147, 196, 294, 392].forEach((f, i) => this.tone(f, 0.9, { type: 'sawtooth', gain: 0.22, delay: i * 0.04 }));
    [784, 988, 1175].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', gain: 0.22, delay: 0.25 + i * 0.08 }));
  }
  click() { this.tone(900, 0.04, { type: 'square', gain: 0.08 }); }
  /** Firecracker: the fuse burns for `dur` seconds. */
  fuse(dur) { this.noise(dur, { gain: 0.16, freq: 7000 }); this.tone(1800, dur, { type: 'sawtooth', gain: 0.02, slide: 1.5 }); }
  /** Firecracker: the bang, then crackles. n = number of firecrackers. */
  bang(n = 1) {
    this.noise(0.42, { gain: 1.0, freq: 1400 });
    this.tone(110, 0.4, { type: 'sine', gain: 0.8, slide: 0.35 });
    this.tone(60, 0.5, { type: 'triangle', gain: 0.5, slide: 0.5 });
    for (let i = 0; i < 6 + 3 * Math.min(n, 3); i++) this.noise(0.05, { gain: 0.5, freq: 3000 + 2500 * Math.random(), delay: 0.08 + 0.07 * i + 0.04 * Math.random() });
  }
  /** A scared fish darts away. */
  flee(i) { this.tone(420 + 60 * (i % 5), 0.22, { type: 'sine', gain: 0.1, slide: 2.4, delay: 0.04 * i }); }

  /** Rising tone for reel anticipation. Call stopRiser() when the reel lands. */
  startRiser(kind) {
    if (!this.enabled || !this.ctx) return;
    this.stopRiser();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const l = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(kind === 'fs' ? 196 : 247, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'fs' ? 784 : 988, t + 2.4);
    l.frequency.value = 11; lg.gain.value = 0.05;
    l.connect(lg); lg.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
    o.connect(g); g.connect(this.master);
    o.start(t); l.start(t);
    this.riserNodes = { o, l, g };
  }

  stopRiser() {
    if (this.rollBus && this.ctx) {                          // the drum roll of a sound theme
      const bus = this.rollBus;
      const t = this.ctx.currentTime;
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + 0.08);
      setTimeout(() => { try { bus.disconnect(); } catch (e) { /* already disconnected */ } }, 200);
      this.rollBus = null;
    }
    if (!this.riserNodes || !this.ctx) return;
    const { o, l, g } = this.riserNodes;
    const t = this.ctx.currentTime;
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.stop(t + 0.1); l.stop(t + 0.1);
    } catch (e) { /* already stopped */ }
    this.riserNodes = null;
  }
}

// ---- sound themes ---------------------------------------------------------
// A theme gives its own version of some sounds (`this` is the Sound object). The other sounds stay as usual.
const THEMES = {
  // Chinese New Year: gongs, drums, woodblock, small cymbals and a plucked string on a pentatonic scale.
  nian: {
    spinStart() { this.block(880, { gain: 0.25 }); this.block(1175, { gain: 0.25, delay: 0.07 }); },
    reelStop(i) { this.drum(105 - i * 5, { gain: 0.42 }); },
    fishLand() { this.pluck(penta(8), 0.25, { gain: 0.16 }); },
    /** The firecracker lands: its fuse hisses. */
    keyLand() {
      this.noise(0.3, { gain: 0.22, freq: 5000, type: 'highpass' });
      this.block(1400, { gain: 0.3 });
      this.pluck(penta(9), 0.4, { gain: 0.2, delay: 0.03 });
    },
    /** The gong lands: each gong on screen is larger and deeper; the third one comes with drum and cymbals. */
    scatterLand(n) {
      if (n <= 1) this.gong(0.3, { gain: 0.45 });
      else if (n === 2) this.gong(0.65, { gain: 0.5 });
      else { this.gong(1, { gain: 0.6 }); this.drum(70, { gain: 0.6 }); this.cymbal({ gain: 0.22, delay: 0.02 }); }
    },
    swap() { this.pluck(penta(9), 0.18, { gain: 0.1 }); this.pluck(penta(10), 0.18, { gain: 0.1, delay: 0.05 }); },
    winTick(step) { this.pluck(penta(Math.min(step, 12), 392), 0.2, { gain: 0.16 }); },
    collect(step) {
      const f = penta(Math.min(step, 14), 440);
      this.pluck(f, 0.35, { gain: 0.3 });
      this.tone(f * 2, 0.25, { type: 'sine', gain: 0.06 });
    },
    smallWin() {
      [5, 7, 8, 10].forEach((k, i) => this.pluck(penta(k, 261.63), 0.45, { gain: 0.24, delay: i * 0.08 }));
      this.cymbal({ gain: 0.1, delay: 0.26, dur: 0.25 });
    },
    multiplier() {
      for (let i = 0; i < 6; i++) this.drum(110, { gain: 0.3 + 0.05 * i, delay: i * 0.06 });
      this.gong(0.2, { gain: 0.4, delay: 0.36 });
    },
    levelUp() {
      this.drum(80, { gain: 0.6 }); this.drum(80, { gain: 0.6, delay: 0.15 });
      [5, 7, 8, 9, 10, 12, 14].forEach((k, i) => this.pluck(penta(k, 261.63), 0.4, { gain: 0.24, delay: 0.3 + i * 0.07 }));
      this.gong(0.7, { gain: 0.42, delay: 0.8 });
      this.cymbal({ gain: 0.16, delay: 0.8 });
    },
    bigWin() {
      [5, 7, 9, 10, 9, 10, 12, 14].forEach((k, i) => {
        this.pluck(penta(k, 261.63), 0.5, { gain: 0.24, delay: i * 0.13 });
        this.pluck(penta(k - 5, 261.63), 0.5, { gain: 0.12, delay: i * 0.13 });
        if (i % 2 === 0) this.drum(85, { gain: 0.45, delay: i * 0.13 });
      });
      this.gong(1, { gain: 0.5, delay: 1.04 });
      this.cymbal({ gain: 0.2, delay: 1.04 });
    },
    bonusEnd() {
      [9, 7, 5, 7, 4, 5].forEach((k, i) => this.pluck(penta(k, 261.63), 0.6, { gain: 0.24, delay: i * 0.14 }));
      this.gong(0.5, { gain: 0.3, delay: 0.84 });
    },
    /** The Nian comes into view: a low growl and three drum heartbeats. */
    krakenNear() {
      this.tone(55, 1.4, { type: 'sawtooth', gain: 0.28, slide: 0.85 });
      this.tone(82.5, 1.4, { type: 'sawtooth', gain: 0.14, slide: 0.85 });
      [0, 0.42, 0.84].forEach((t) => { this.drum(60, { gain: 0.55, delay: t }); this.drum(52, { gain: 0.4, delay: t + 0.13 }); });
    },
    krakenMiss() {
      this.tone(300, 0.6, { type: 'sawtooth', gain: 0.18, slide: 0.25 });
      this.noise(0.15, { gain: 0.3, freq: 4000, type: 'highpass' });
      this.gong(0.35, { gain: 0.22, delay: 0.1 });
    },
    krakenHit() {
      this.gong(1, { gain: 0.55 });
      this.cymbal({ gain: 0.25 });
      [73, 110, 147].forEach((f) => this.tone(f, 0.8, { type: 'sawtooth', gain: 0.14, slide: 0.8 }));
      [10, 12, 14].forEach((k, i) => this.pluck(penta(k, 261.63), 0.5, { gain: 0.22, delay: 0.3 + i * 0.08 }));
    },
    click() { this.block(1000, { gain: 0.12 }); },
    bang(n = 1) { this.base.bang(n); this.cymbal({ gain: 0.2, delay: 0.03 }); },
    /**
     * Anticipation. Call stopRiser() when the reel lands. The two kinds sound different:
     * 'fs' (two gongs are in): a deep drum roll that gets faster, with gong strokes that get larger;
     * other (a firecracker is in): the hiss of a fuse that gets louder, with woodblock ticks that get faster and higher.
     */
    startRiser(kind) {
      if (!this.enabled || !this.ctx) return;
      this.stopRiser();
      const bus = this.ctx.createGain();
      bus.gain.value = 1;
      bus.connect(this.master);
      this.rollBus = bus;
      const grow = (t) => Math.min(1, t / 2.4);
      if (kind === 'fs') {
        let t = 0; let gap = 0.22;
        while (t < 7) {
          this.drum(80, { gain: 0.2 + 0.28 * grow(t), delay: t, dur: 0.16, out: bus });
          gap = Math.max(0.06, gap * 0.9);
          t += gap;
        }
        for (let k = 0; k < 14; k++) this.gong(Math.min(0.2 + 0.1 * k, 0.8), { gain: 0.12 + 0.03 * Math.min(k, 6), delay: 0.5 * k, out: bus });
      } else {
        for (let t = 0; t < 7; t += 0.07) {
          this.noise(0.1, { gain: 0.05 + 0.2 * grow(t), freq: 5500 + 2500 * Math.random(), type: 'highpass', delay: t, out: bus });
        }
        let t = 0; let gap = 0.2; let n = 0;
        while (t < 7) {
          this.block(1100 * Math.pow(1.035, Math.min(n, 18)), { gain: 0.12 + 0.16 * grow(t), delay: t, out: bus });
          gap = Math.max(0.07, gap * 0.92);
          t += gap; n++;
        }
      }
    },
  },
};

