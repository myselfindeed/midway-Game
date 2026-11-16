import * as THREE from 'three';
import { Input } from './Input.js';
import { Game } from './Game.js';
import { UI } from './UI.js';
import { preloadTextures, preloadFighter, preloadCarrier, applyRendererAnisotropy } from './models.js';

const canvas = document.getElementById('game');
const btnStart = document.getElementById('btnStart');
const lead = document.querySelector('.lead');

const input = new Input({
  joystickEl: document.getElementById('joystick'),
  stickEl: document.getElementById('stick'),
  fireBtn: document.getElementById('btnFire'),
  boostBtn: document.getElementById('btnBoost'),
  missileBtn: document.getElementById('btnMissile'),
  shieldBtn: document.getElementById('btnShield'),
});

const ui = new UI();
let game = null;

if (btnStart) {
  btnStart.disabled = true;
  btnStart.textContent = '加载载具贴图…';
}
if (lead) lead.textContent = '正在加载现代战机低模…';

function wireGame(g) {
  ui.onStart = () => g.startLevel();

  ui.onRetry = (cp) => {
    if (cp === 'start') g.checkpoint = 'start';
    else if (cp === 'cp1') g.checkpoint = 'cp1';
    g.paused = false;
    g.running = true;
    g.resetToCheckpoint();
    g.clock.start();
    if (!g._raf) g.loop();
  };

  ui.onPauseToggle = () => {
    if (g.ended) return;
    if (!g.running && !g.paused) return;
    if (!g.paused) {
      g.setPaused(true);
      ui.hud.classList.add('hidden');
      ui.showPaused(() => g.setPaused(false), g.checkpoint);
    }
  };

  function fit() {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    g.resize();
  }
  fit();
  window.addEventListener('resize', fit);
}

function boot(withTexture, withModel) {
  game = new Game(canvas, input, ui);
  if (withTexture || withModel) applyRendererAnisotropy(game.renderer);
  wireGame(game);
  if (btnStart) {
    btnStart.disabled = false;
    btnStart.textContent = withModel ? '开始任务' : '开始任务（程序化战机）';
  }
  if (lead) {
    lead.textContent = withModel
      ? '云上的眼睛 · 现代战机低模已接入'
      : withTexture
        ? '低模加载失败，使用程序化战机'
        : '贴图与低模加载失败，已使用程序化低模';
  }
}

const probe = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
Promise.allSettled([
  preloadTextures({
    destroyer: 'assets/destroyer.png',
    carrier: 'assets/carrier.png',
  }),
  preloadFighter('assets/models/fighter.glb', probe),
  preloadCarrier('assets/models/carrier.glb'),
]).then(([tex, model, carrier]) => {
  probe.dispose();
  if (model.status === 'rejected') {
    console.warn('[小宝特工空战] 战机低模加载失败', model.reason);
  } else {
    console.info('[小宝特工空战] fighter.glb 就绪');
  }
  if (carrier.status === 'rejected') {
    console.warn('[小宝特工空战] 航母低模加载失败', carrier.reason);
  } else {
    console.info('[小宝特工空战] carrier.glb 就绪');
  }
  boot(tex.status === 'fulfilled', model.status === 'fulfilled');
});
