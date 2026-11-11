// Small WebAudio synthesiser. No audio files. Starts on the first user gesture.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.riserNodes = null;
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

  tone(freq, dur, { type = 'sine', gain = 0.5, delay = 0, slide = 0 } = {}) {
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
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { gain = 0.3, delay = 0, freq = 900 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
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
