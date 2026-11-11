// Demo suite: forced outcomes, art asset selection, statistics, quick
// simulation, settings and live math configuration.

import { Rng, prepare, newSpinOut, baseSpin, bonusStart, bonusSpin, validateConfig } from './engine.js';
import { createForcer } from './forces.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(2) + '%' : '-');
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => e.append(c));
  return e;
};

export class Demo {
  constructor({ game, assets, root, fileCfg, theo, onToggle }) {
    this.game = game; this.assets = assets; this.root = root; this.fileCfg = fileCfg; this.theo = theo;
    this.onToggle = onToggle;
    this.forcer = createForcer(game.model);
    this.simRunning = false;
    this.build();
    game.on('stats', () => this.renderStats());
    game.on('queue', () => this.renderQueue());
    game.on('swap', () => this.renderSwap());
    game.on('config', () => { this.forcer = createForcer(game.model); this.renderMath(); });
    assets.onChange(() => { this.renderAssets(); this.forcesBody.innerHTML = ''; this.buildForces(this.forcesBody); });
  }

  section(title, open = false) {
    const body = h('div', { class: 'body' });
    const d = h('details', {}, h('summary', { text: title }), body);
    if (open) d.setAttribute('open', '');
    this.root.append(d);
    return body;
  }

  build() {
    const { root } = this;
    root.innerHTML = '';
    root.append(h('h2', { text: 'DEMO SUITE' }), h('p', { class: 'sub', text: 'Tools for demonstrations and tests. Forced outcomes use the real reel strips and the real engine.' }));
    this.forcesBody = this.section('FORCE OUTCOMES', true);
    this.buildForces(this.forcesBody);
    this.assetsBody = this.section('ART ASSETS');
    this.renderAssets();
    this.statsBody = this.section('SESSION STATISTICS');
    this.renderStats();
    this.buildSim(this.section('QUICK SIMULATION'));
    this.buildSettings(this.section('SETTINGS'));
    this.mathBody = this.section('MATH CONFIGURATION');
    this.renderMath();
  }

  // ------------------------------------------------------------ forces
  force(scope, label, name, ...args) {
    const f = this.forcer.get(name, ...args);
    if (!f) { this.queueBox.textContent = `No reel stops found for "${label}" with the current reel strips.`; return; }
    if (this.maxFish && this.maxFish.checked) f.fishPick = 'max';
    this.game.queueForce(label, f, scope);
  }

  buildForces(body) {
    const g = this.game;
    const btn = (text, fn) => h('button', { text, onclick: () => { g.sound.unlock(); fn(); } });
    const bonusMode = () => `level${g.bonus ? g.bonus.level : 1}`;
    const K = g.L.key; const item = g.L.item; const top = g.L.top.charAt(0) + g.L.top.slice(1).toLowerCase();
    body.append(
      h('h4', { text: 'Next base spin' }),
      h('div', { class: 'btns' },
        btn('3 FS trigger', () => this.force('base', '3 FS trigger', 'fs', 3)),
        btn('4 FS trigger', () => this.force('base', '4 FS trigger', 'fs', 4)),
        btn('5 FS trigger', () => this.force('base', '5 FS trigger', 'fs', 5)),
        btn('FS tease (2 FS)', () => this.force('base', 'FS tease', 'fsTease')),
        btn(`${K} + ${item}`, () => this.force('base', `${K} + ${item}`, 'keyFish', 'base', 'base')),
        btn(`${K} + FISH3`, () => this.force('base', `${K} + FISH3`, 'keyFish3', 'base', 'base')),
        btn(`${K} + FISH4 (${top})`, () => this.force('base', `${K} + FISH4`, 'keyFish4', 'base', 'base')),
        btn(`${K}, no ${item}`, () => this.force('base', `${K}, no ${item}`, 'keyTease', 'base', 'base')),
        btn(`2 ${K} symbols + ${item}`, () => this.force('base', `2 ${K} + ${item}`, 'multiKey', 'base', 'base', 2)),
        btn(`${top} slides out`, () => this.force('base', `${top} slides out`, 'krakenMiss', 'base', 'base', 0)),
        btn(`${top} passes by`, () => this.force('base', `${top} passes by`, 'krakenMiss', 'base', 'base', 5)),
        btn('Big ways win', () => this.force('base', 'Big ways win', 'bigWays', 'base', 'base')),
        btn('Small ways win', () => this.force('base', 'Small ways win', 'smallWays', 'base', 'base')),
        btn('No win', () => this.force('base', 'No win', 'dead', 'base', 'base'))),
      h('h4', { text: 'Next free spin' }),
      h('div', { class: 'btns' },
        btn(`${K} + ${item}`, () => this.force('bonus', `FS: ${K} + ${item}`, 'keyFish', 'bonus', bonusMode())),
        btn(`${K} + FISH3`, () => this.force('bonus', `FS: ${K} + FISH3`, 'keyFish3', 'bonus', bonusMode())),
        btn(`${K} + FISH4 (${top})`, () => this.force('bonus', `FS: ${K} + FISH4`, 'keyFish4', 'bonus', bonusMode())),
        btn(`2 ${K} symbols`, () => this.force('bonus', `FS: 2 ${K}`, 'multiKey', 'bonus', bonusMode(), 2)),
        btn(`3 ${K} symbols`, () => this.force('bonus', `FS: 3 ${K}`, 'multiKey', 'bonus', bonusMode(), 3)),
        btn(`${top} passes by`, () => this.force('bonus', `FS: ${top} passes by`, 'krakenMiss', 'bonus', bonusMode(), 3)),
        btn(`No ${K}`, () => this.force('bonus', `FS: no ${K}`, 'noKey', 'bonus', bonusMode())),
        btn('Big ways win', () => this.force('bonus', 'FS: big ways', 'bigWays', 'bonus', bonusMode())),
        btn(`3 x ${K} + ${item}`, () => { for (let i = 0; i < 3; i++) this.force('bonus', `FS: ${K} + ${item}`, 'keyFish', 'bonus', bonusMode()); }),
        btn('No win', () => this.force('bonus', 'FS: no win', 'dead', 'bonus', bonusMode()))),
    );
    this.maxFish = h('input', { type: 'checkbox' });
    body.append(h('label', { class: 'check' }, this.maxFish, 'Forced spins use the largest fish values'));
    // custom stops
    this.stopInputs = Array.from({ length: g.model.reelCount }, () => h('input', { type: 'number', min: '0', max: '99', value: '0' }));
    const scopeSel = h('select', {}, h('option', { value: 'base', text: 'base spin' }), h('option', { value: 'bonus', text: 'free spin' }));
    body.append(h('h4', { text: 'Custom reel stops (strip position of the top row)' }), h('div', { class: 'row5' }, this.stopInputs),
      h('div', { class: 'btns', style: 'margin-top:6px' }, scopeSel,
        btn('Queue custom stops', () => {
          const stops = this.stopInputs.map((i) => Number(i.value) || 0);
          const f = { stops };
          if (this.maxFish.checked) f.fishPick = 'max';
          g.queueForce(`Stops ${stops.join(',')}`, f, scopeSel.value);
        })));
    body.append(h('h4', { text: 'Start the free spins now (no bet)' }),
      h('div', { class: 'btns' },
        ...Object.entries(g.cfg.freeSpins.triggerSpins).map(([k, v]) => btn(`${k} FS (${v} spins)`, () => g.demoBonus(Number(k), 1))),
        ...g.cfg.freeSpins.levels.slice(1).map((l) => btn(`Start at level ${l.level} (x${l.multiplier})`, () => g.demoBonus(3, l.level)))));
    this.queueBox = h('div', { class: 'queue' });
    body.append(h('h4', { text: 'Queue' }), this.queueBox, h('div', { class: 'btns', style: 'margin-top:6px' }, btn('Clear queue', () => g.clearQueue())));
    this.renderQueue();
  }

  renderQueue() {
    const q = this.game.queue;
    this.queueBox.textContent = q.length ? q.map((x, i) => `${i + 1}. ${x.label}`).join('   ') : 'Empty. The next spins are random.';
  }

  // ------------------------------------------------------------ assets
  renderAssets() {
    const body = this.assetsBody;
    const a = this.assets;
    body.innerHTML = '';
    if (!a.keys.size) { body.append(h('p', { class: 'warn', text: 'No asset manifest found. The game shows placeholder art.' })); return; }
    body.append(h('h4', { text: 'Asset set for all symbols' }),
      h('div', { class: 'btns' }, a.setIds.map((id) => h('button', {
        text: `Set ${id}: ${a.manifest.sets[id].label}`, class: a.sel.set === id && !Object.keys(a.sel.overrides).length ? 'sel' : '', onclick: () => a.selectSet(id),
      }))),
      h('h4', { text: 'Asset for each symbol (click a picture)' }));
    const grid = h('div', { class: 'assetgrid' });
    for (const key of a.keys) {
      const tw = a.setIds.length > 3 ? 44 : 58;
      const row = h('div', { class: 'arow', style: `grid-template-columns: 1fr repeat(${a.setIds.length}, ${tw}px)` }, h('span', { text: key }));
      for (const id of a.setIds) {
        const im = a.images[id] && a.images[id][key];
        const t = h('div', { class: 'thumb' + (a.setFor(key) === id ? ' sel' : ''), style: `width:${tw}px`, title: `${key} - set ${id}`, onclick: () => a.override(key, id) });
        if (im) t.style.backgroundImage = `url("${im.src}")`; else t.textContent = '-';
        row.append(t);
      }
      grid.append(row);
    }
    body.append(grid);
    if (a.manifest.generatedWith) body.append(h('p', { class: 'sub', text: `Assets: ${a.manifest.generatedWith}` }));
  }

  // ------------------------------------------------------------ statistics
  renderStats() {
    const s = this.game.stats;
    const bet = this.game.cfg.bet;
    const rows = [
      ['Spins', fmt(s.spins)], ['Wagered (credits)', fmt(s.wagered)], ['Won (credits)', fmt(s.won)],
      ['Session RTP', s.wagered ? pct(s.won / s.wagered) : '-'],
      ['Base spins with a win', s.spins ? pct(s.hits / s.spins) : '-'],
      [`Spins with a ${this.game.keyLabel}`, fmt(s.keys)], [`${this.game.keyLabel} collects`, fmt(s.collects)],
      ['Free spins features', fmt(s.bonuses)], ['Won in free spins', fmt(s.bonusWon)],
      ['Largest round win', `${fmt(s.biggest)} (${(s.biggest / bet).toFixed(1)} x)`],
    ];
    this.statsBody.innerHTML = '';
    this.statsBody.append(h('table', {}, rows.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v })))),
      h('div', { class: 'btns', style: 'margin-top:8px' }, h('button', { text: 'Reset statistics', onclick: () => this.game.resetStats() })));
  }

  // ------------------------------------------------------------ quick simulation
  buildSim(body) {
    const sel = h('select', {}, ...[['100000', '100 000 rounds'], ['1000000', '1 000 000 rounds'], ['5000000', '5 000 000 rounds']].map(([v, t]) => h('option', { value: v, text: t })));
    this.simOut = h('div', {});
    body.append(h('p', { class: 'sub', text: 'Runs the game engine in this browser with the current configuration. It does not change your balance.' }), sel,
      h('div', { class: 'btns', style: 'margin-top:6px' },
        h('button', { text: 'Run simulation', onclick: () => this.runSim(Number(sel.value)) }),
        h('button', { text: 'Stop', onclick: () => { this.simRunning = false; } })), this.simOut);
  }

  runSim(total) {
    if (this.simRunning) return;
    this.simRunning = true;
    const cfg = this.game.cfg;
    const model = prepare(cfg);
    const rng = new Rng((Math.random() * 0xffffffff) >>> 0);
    const bo = newSpinOut(model, 'base'); const fo = newSpinOut(model, 'bonus');
    const st = { n: 0, ways: 0, fish: 0, bonus: 0, hits: 0, trig: 0, sq: 0, max: 0, reach: model.levels.map(() => 0) };
    const t0 = performance.now();
    const chunk = () => {
      const end = Math.min(total, st.n + 20000);
      for (; st.n < end; st.n++) {
        const b = baseSpin(model, rng, null, bo);
        let round = b.win;
        st.ways += bo.waysWin; st.fish += bo.fishWin;
        if (b.win > 0) st.hits++;
        if (b.freeSpins) {
          st.trig++;
          const state = bonusStart(model, bo.scatterCount);
          st.reach[0]++;
          while (!state.done) { const r = bonusSpin(model, state, rng, null, fo); if (r.event === 'levelUp') st.reach[state.levelIndex]++; }
          st.bonus += state.totalWin; round += state.totalWin;
        }
        st.sq += round * round;
        if (round > st.max) st.max = round;
      }
      this.renderSim(st, total, performance.now() - t0);
      if (st.n < total && this.simRunning) setTimeout(chunk, 0); else this.simRunning = false;
    };
    chunk();
  }

  renderSim(st, total, ms) {
    const bet = this.game.cfg.bet;
    const w = st.n * bet;
    const mean = (st.ways + st.fish + st.bonus) / st.n;
    const sd = Math.sqrt(Math.max(0, st.sq / st.n - mean * mean)) / bet;
    const t = this.theo && this.theo.rtp;
    const rows = [
      ['Rounds', `${fmt(st.n)} / ${fmt(total)}  (${(ms / 1000).toFixed(1)} s)`],
      ['RTP', pct(mean / bet) + (t ? `   theory ${pct(t.total)}` : '')],
      ['Base ways', pct(st.ways / w) + (t ? `   theory ${pct(t.baseWays)}` : '')],
      ['Base fish collect', pct(st.fish / w) + (t ? `   theory ${pct(t.baseFish)}` : '')],
      ['Free spins', pct(st.bonus / w) + (t ? `   theory ${pct(t.bonus)}` : '')],
      ['RTP standard error', pct(sd / Math.sqrt(st.n))],
      ['Standard deviation (x bet)', sd.toFixed(2)],
      ['Base spins with a win', pct(st.hits / st.n)],
      ['Free spins: 1 in', st.trig ? (st.n / st.trig).toFixed(1) : '-'],
      ['Mean free spins win (x bet)', st.trig ? (st.bonus / st.trig / bet).toFixed(1) : '-'],
      ['Levels played', st.trig ? st.reach.map((x, i) => `L${i + 1} ${pct(x / st.trig)}`).join('  ') : '-'],
      ['Largest round (x bet)', (st.max / bet).toFixed(1)],
    ];
    this.simOut.innerHTML = '';
    this.simOut.append(h('table', {}, rows.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v })))));
    if (t && this.game.cfg !== this.fileCfg) this.simOut.append(h('p', { class: 'sub', text: 'Theory values are for the configuration file, not for your edited configuration.' }));
  }

  // ------------------------------------------------------------ settings
  buildSettings(body) {
    const g = this.game;
    const swap = h('input', { type: 'number', min: '0', max: '3000', step: '50', value: String(g.settings.swapDelayMs) });
    swap.onchange = () => { g.settings.swapDelayMs = Math.max(0, Number(swap.value) || 0); };
    this.swapInfo = h('p', { class: 'sub', text: 'No spin yet.' });
    const antic = h('input', { type: 'checkbox' });
    antic.checked = true;
    antic.onchange = () => { g.settings.anticipation = antic.checked; };
    const slow = h('input', { type: 'checkbox' });
    slow.checked = true;
    slow.onchange = () => { g.settings.slowdown = slow.checked; };
    const seed = h('input', { type: 'text', placeholder: 'empty = random' });
    body.append(
      h('label', { text: 'Fish value swap: delay after the wager (ms)' }), swap, this.swapInfo,
      h('label', { class: 'check' }, antic, `Reel anticipation (${g.keyLabel} and FS)`),
      h('label', { class: 'check' }, slow, 'Slow motion when the top prize symbol comes into view on an anticipating reel'),
      h('label', { text: 'Random number seed (same seed = same results)' }), seed,
      h('div', { class: 'btns', style: 'margin-top:6px' },
        h('button', { text: 'Apply seed', onclick: () => { const v = seed.value.trim(); g.reseed(v === '' ? null : Number(v)); } }),
        h('button', { text: 'Add 10,000 credits', onclick: () => g.setBalance(g.balance + 10000) })));
  }

  renderSwap() {
    if (this.swapInfo && this.game.lastSwapMs !== null) {
      this.swapInfo.textContent = `Last swap: ${this.game.lastSwapMs.toFixed(0)} ms after the wager, while the reels were in motion.`;
    }
  }

  // ------------------------------------------------------------ math configuration
  renderMath() {
    const body = this.mathBody;
    const g = this.game;
    body.innerHTML = '';
    const v = validateConfig(g.cfg);
    body.append(h('p', { class: v.warnings.length ? 'warn' : 'ok', text: v.warnings.length ? `Reel rule warnings: ${v.warnings.slice(0, 4).join('; ')}` : 'Reel strips obey all design rules.' }));
    if (this.theo) {
      const t = this.theo.rtp;
      body.append(h('table', {}, [['Theoretical RTP (configuration file)', pct(t.total)], ['Base ways', pct(t.baseWays)], ['Base fish collect', pct(t.baseFish)], ['Free spins', pct(t.bonus)]]
        .map(([k, x]) => h('tr', {}, h('td', { text: k }), h('td', { text: x })))));
    }
    const { reels, reelRecipe, ...small } = g.cfg;
    const ta = h('textarea', { spellcheck: 'false' });
    ta.value = JSON.stringify(small, null, 1);
    const msg = h('p', { class: 'sub', text: 'Edit the values and apply. The reel strips stay as they are. Use "Load file" for a full configuration with reel strips.' });
    const apply = (cfg) => {
      try { g.setConfig(cfg); msg.className = 'ok'; msg.textContent = 'Configuration applied.'; } catch (e) { msg.className = 'warn'; msg.textContent = e.message; }
    };
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    file.onchange = async () => { if (file.files[0]) { try { apply(JSON.parse(await file.files[0].text())); } catch (e) { msg.className = 'warn'; msg.textContent = e.message; } } };
    body.append(h('h4', { text: 'Live configuration (JSON)' }), ta,
      h('div', { class: 'btns', style: 'margin-top:6px' },
        h('button', { text: 'Apply', onclick: () => { if (g.busy) return; try { apply({ ...JSON.parse(ta.value), reels, reelRecipe }); } catch (e) { msg.className = 'warn'; msg.textContent = e.message; } } }),
        h('button', { text: 'Reset to file', onclick: () => { if (!g.busy) apply(this.fileCfg); } })),
      h('label', { text: 'Load file (game_config.json)' }), file, msg);
  }
}
