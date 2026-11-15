import { Input } from './Input.js';
import { Game } from './Game.js';
import { UI } from './UI.js';
import { preloadTextures, applyRendererAnisotropy } from './models.js';

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
if (lead) lead.textContent = '正在接入 fighter / destroyer / carrier 参考质感…';

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

function boot(withTexture) {
  game = new Game(canvas, input, ui);
  if (withTexture) applyRendererAnisotropy(game.renderer);
  wireGame(game);
  if (btnStart) {
    btnStart.disabled = false;
    btnStart.textContent = withTexture ? '开始任务' : '开始任务（无贴图）';
  }
  if (lead) {
    lead.textContent = withTexture
      ? '云上的眼睛 · 灰色现代战机与青色界面'
      : '贴图加载失败，已使用程序化低模';
  }
}

preloadTextures({
  fighter: 'assets/fighter.png',
  destroyer: 'assets/destroyer.png',
  carrier: 'assets/carrier.png',
})
  .then(() => {
    boot(true);
    console.info('[小宝特工空战] fighter/destroyer/carrier 贴图就绪');
  })
  .catch((err) => {
    console.warn('[小宝特工空战] 贴图加载失败，回退低模', err);
    boot(false);
  });
