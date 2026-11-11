// Art asset manager: two (or more) swappable asset sets, per-symbol overrides,
// pre-rasterised sprites for the reel canvas, and a drawn placeholder for any
// asset that is missing.

const STORE_KEY = 'ttk.assets.v1';

const PLACEHOLDER_COLORS = {
  PIC: ['#7b2d8e', '#f0c8ff'], AUS: ['#1d4e89', '#cfe6ff'], FISH: ['#0c7c59', '#d6ffe9'],
  KEY: ['#b8860b', '#fff3c4'], WILD: ['#b3261e', '#ffe0dc'], FS: ['#5b2ca0', '#eadcff'],
};

export class Assets {
  constructor(manifest, base = 'assets/') {
    this.manifest = manifest || { sets: { A: { label: 'Placeholder', dir: 'setA' } }, keys: [] };
    this.base = base;
    this.keys = new Set(this.manifest.keys || []);
    this.setIds = Object.keys(this.manifest.sets);
    this.images = {};            // images[set][key] = HTMLImageElement | null
    this.sprites = new Map();
    this.listeners = [];
    // the set that a new visitor sees: manifest "defaultSet", or the first set
    const first = this.manifest.sets[this.manifest.defaultSet] ? this.manifest.defaultSet : this.setIds[0];
    this.sel = { set: first, overrides: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && this.manifest.sets[saved.set]) {
        this.sel.set = saved.set;
        for (const [k, v] of Object.entries(saved.overrides || {})) {
          if (this.manifest.sets[v]) this.sel.overrides[k] = v;
        }
      }
    } catch (e) { /* storage not available: use defaults */ }
  }

  url(key, set) { return `${this.base}${this.manifest.sets[set].dir}/${key}.svg`; }

  async load(onProgress) {
    const jobs = [];
    let done = 0;
    const total = this.setIds.length * this.keys.size;
    for (const set of this.setIds) {
      this.images[set] = {};
      for (const key of this.keys) {
        jobs.push(new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => { this.images[set][key] = img; done++; if (onProgress) onProgress(done / total); resolve(); };
          img.onerror = () => { this.images[set][key] = null; done++; if (onProgress) onProgress(done / total); resolve(); };
          img.src = this.url(key, set);
        }));
      }
    }
    await Promise.all(jobs);
  }

  setFor(key) { return this.sel.overrides[key] || this.sel.set; }

  /** The image for a key in the selected set; falls back to any set that has it. */
  img(key) {
    const first = this.setFor(key);
    for (const set of [first, ...this.setIds]) {
      const im = this.images[set] && this.images[set][key];
      if (im) return im;
    }
    return null;
  }

  /** URL for <img> tags (paytable, panels). Null if the asset is missing. */
  src(key) {
    const im = this.img(key);
    return im ? im.src : null;
  }

  /** Asset key for a symbol; FISH symbols have one asset for each value. */
  keyFor(symbol, value) {
    if (value !== undefined && value !== null && symbol.startsWith('FISH')) {
      const k = `${symbol}_${value}`;
      if (this.keys.has(k)) return { key: k, overlay: null };
      return { key: symbol, overlay: String(value) };   // generic fish + drawn number
    }
    return { key: symbol, overlay: null };
  }

  /** Canvas sprite for a symbol at w x h device pixels (cached). */
  sprite(symbol, value, w, h) {
    const { key, overlay } = this.keyFor(symbol, value);
    const set = this.setFor(key);
    const id = `${key}|${overlay}|${set}|${w}x${h}`;
    let c = this.sprites.get(id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const im = this.img(key);
    const size = Math.min(w, h);
    if (im) {
      g.drawImage(im, (w - size) / 2, (h - size) / 2, size, size);
    } else {
      this.drawPlaceholder(g, symbol, w, h, overlay === null && value != null ? String(value) : null);
    }
    if (overlay !== null) this.drawNumber(g, overlay, w, h);
    this.sprites.set(id, c);
    return c;
  }

  drawPlaceholder(g, symbol, w, h, value) {
    const fam = Object.keys(PLACEHOLDER_COLORS).find((k) => symbol.startsWith(k)) || 'AUS';
    const [bg, fg] = PLACEHOLDER_COLORS[fam];
    const size = Math.min(w, h) * 0.86;
    const x = (w - size) / 2; const y = (h - size) / 2; const r = size * 0.16;
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(x, y, size, size, r); g.fill();
    g.lineWidth = Math.max(2, size * 0.03); g.strokeStyle = fg; g.stroke();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${Math.round(size * 0.22)}px system-ui, sans-serif`;
    g.fillText(symbol, w / 2, value ? h / 2 - size * 0.14 : h / 2);
    if (value) {
      g.font = `900 ${Math.round(size * 0.3)}px system-ui, sans-serif`;
      g.fillText(value, w / 2, h / 2 + size * 0.16);
    }
  }

  drawNumber(g, text, w, h) {
    const size = Math.min(w, h);
    g.font = `900 ${Math.round(size * 0.3)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = size * 0.06; g.strokeStyle = '#04121f'; g.lineJoin = 'round';
    g.strokeText(text, w / 2, h * 0.72);
    g.fillStyle = '#ffe680';
    g.fillText(text, w / 2, h * 0.72);
  }

  // ------------------------------------------------------------ selection
  save() {
    if (this.pinned) return;                 // set chosen in the page address: do not change the saved choice
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.sel)); } catch (e) { /* ignore */ }
  }

  /** Show one set for this page only (address ...?set=D). The saved choice stays as it is. */
  pin(set) {
    if (!this.manifest.sets[set]) return false;
    this.sel = { set, overrides: {} };
    this.pinned = true;
    return true;
  }
  changed() {
    this.sprites.clear();
    this.save();
    this.listeners.forEach((f) => f());
  }
  onChange(f) { this.listeners.push(f); }
  selectSet(set) { this.sel.set = set; this.sel.overrides = {}; this.changed(); }
  override(key, set) {
    if (set === this.sel.set) delete this.sel.overrides[key]; else this.sel.overrides[key] = set;
    this.changed();
  }
}
