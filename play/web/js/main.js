// Start-up: load the configuration and the art, then start the game.

import { Assets } from './assets.js';
import { Sound } from './audio.js';
import { ReelView } from './reels.js';
import { Game } from './game.js';
import { Demo } from './demo.js';

const $ = (id) => document.getElementById(id);

async function getJson(url, optional) {
  let lastError = null;
  for (let attempt = 0; attempt < (optional ? 1 : 3); attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastError = e;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  if (optional) return null;
  throw lastError;
}

async function start() {
  const loadBar = $('loadBar').firstElementChild;
  const cfg = await getJson('../config/game_config.json');
  const manifest = await getJson('assets/manifest.json', true);
  const theo = await getJson('../build/theo.json', true);
  const assets = new Assets(manifest);
  const wantSet = new URLSearchParams(location.search).get('set');
  if (wantSet) assets.pin(wantSet.toUpperCase());
  await assets.load((p) => { loadBar.style.width = `${Math.round(p * 100)}%`; });

  const sound = new Sound();
  const view = new ReelView($('reels'), assets, { reels: cfg.reelCount, rows: cfg.rows });
  const dom = {};
  for (const id of ['bg', 'logo', 'logoText', 'ladderRows', 'ladderTitle', 'ladderNote', 'fishNote', 'fishTitle', 'keyCountLabel', 'bonusInfo', 'spinsLeft', 'keyCount', 'bonusWin',
    'fishRows', 'fx', 'status', 'balance', 'bet', 'win', 'btnSpin', 'btnAuto', 'btnTurbo', 'btnSound', 'btnInfo', 'overlay', 'overlayCard', 'paytable']) dom[id] = $(id);
  const game = new Game({ cfg, assets, sound, view, dom });

  // stage scale
  const stage = $('stage');
  const fit = () => {
    const vp = $('viewport').getBoundingClientRect();
    const s = Math.min(vp.width / 1280, vp.height / 720);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    view.resize(s * (window.devicePixelRatio || 1));
  };
  window.addEventListener('resize', fit);

  // controls
  dom.btnSpin.onclick = () => game.press();
  dom.btnAuto.onclick = () => { sound.unlock(); game.setAuto(!game.auto); };
  dom.btnTurbo.onclick = () => { sound.unlock(); game.setTurbo(!game.turbo); };
  dom.btnSound.onclick = () => { sound.unlock(); sound.setEnabled(!sound.enabled); dom.btnSound.classList.toggle('off', !sound.enabled); };
  dom.btnInfo.onclick = () => {
    dom.paytable.innerHTML = game.paytableHtml();
    dom.paytable.classList.remove('hidden');
    dom.paytable.querySelector('.close').onclick = () => dom.paytable.classList.add('hidden');
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    e.preventDefault();
    if (!dom.paytable.classList.contains('hidden')) { dom.paytable.classList.add('hidden'); return; }
    game.press();
  });

  // demo suite
  const demoRoot = $('demo');
  const demo = new Demo({ game, assets, root: demoRoot, fileCfg: cfg, theo });
  const toggleDemo = (open) => {
    demoRoot.classList.toggle('closed', !open);
    document.documentElement.style.setProperty('--demo-w', open ? '380px' : '0px');
    fit();
  };
  $('btnDemo').onclick = () => toggleDemo(demoRoot.classList.contains('closed'));
  toggleDemo(new URLSearchParams(location.search).get('demo') === '1');

  fit();
  $('loading').classList.add('hidden');
  window.ttk = { game, view, assets, demo, sound };   // for tests and the console
}

start().catch((e) => {
  console.error(e);
  $('loading').innerHTML = `<div style="color:#ff5d5d;max-width:700px">The game did not start.<br>${String(e.message || e)}<br><br>`
    + 'Serve the project folder with a web server and open /web/ (see README.md).</div>';
});
