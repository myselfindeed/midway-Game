import * as THREE from 'three';
import { Input } from './Input.js';
import { Game } from './Game.js';
import { UI } from './UI.js';
import { preloadTextures, preloadFighter, preloadCarrier, applyRendererAnisotropy } from './models.js';
import { getLevel } from './levels.js';

// 阻止移动浏览器缩放（双击缩放 + 双指缩放）。
// 手机浏览器快速点按控制按钮会被识别为"双击"而放大页面，双指也会缩放；
// viewport 的 user-scalable=no 在现代 iOS/Chrome 被忽略，touch-action 也拦不住 iOS 双击，
// 故在 JS 层拦截。控制按钮走 pointer 事件，不受 touchend preventDefault 影响。
(function preventPageZoom() {
  const stop = (e) => e.preventDefault();
  // iOS 双指手势缩放
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  // 双击缩放：时间+位置都接近的连续 tap 视为双击，阻止第二次触发放大
  let last = { t: 0, x: 0, y: 0 };
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    const t = e.changedTouches && e.changedTouches[0];
    if (t) {
      const dx = t.clientX - last.x;
      const dy = t.clientY - last.y;
      if (now - last.t <= 350 && Math.hypot(dx, dy) < 30) {
        e.preventDefault();
      }
      last = { t: now, x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  // 兜底：桌面/部分浏览器的双击事件
  document.addEventListener('dblclick', stop, { passive: false });
})();

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
  ui.onStart = () => g.startLevel(1);
  ui.onSelectLevel = (id) => g.startLevel(id);

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
  // 调试钩子：带 ?debug 打开时暴露实例，便于本地排查与截图
  if (new URLSearchParams(location.search).has('debug')) {
    window.__game = game;
    window.__THREE = THREE;   // 调试用：控制台里可以直接造物体验证渲染管线
    // 音效试听：不用等锁定敌机也能听发射音，按 1 = 导弹发射、2 = 敌机爆炸
    window.addEventListener('keydown', (e) => {
      if (e.key === '1') game.ui.playSfx('missile', { gain: 1 });
      if (e.key === '2') game.ui.playSfx('explode', { gain: 1, pan: 0 });
    });
  }
  if (withTexture || withModel) applyRendererAnisotropy(game.renderer);
  wireGame(game);

  // 直达关卡（联调 / 截图用）：?level=2 跳过关卡选择与简报。
  // 正常入口仍然走「开始任务 → 选择关卡 → 简报」。
  const directLevel = Number(new URLSearchParams(location.search).get('level'));
  if (directLevel >= 1) {
    const level = getLevel(directLevel);
    if (level.playable) ui.beginLevel(level.id);
  }

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
  // 供 index.html 的兜底脚本判断"应用是否真的启动成功"（模块加载失败时这里不会执行）
  window.__appReady = true;
}

// KTX2Loader.detectSupport() 需要一个真实渲染器，但**绝不能借用游戏 canvas**：
// 一个 canvas 只能有一个 WebGL 上下文，属性以第一次创建为准。
// 这里若传 canvas，probe 的 antialias:false 会被固化，Game 里的 antialias:true 永远无效
// （实测 Samples=0，全场景零 MSAA，所有边缘都是硬锯齿）。
// 用一块临时 canvas 建上下文，用完立刻释放。
const probeCanvas = document.createElement('canvas');
const probe = new THREE.WebGLRenderer({
  canvas: probeCanvas,
  antialias: false,
  alpha: true,
  powerPreference: 'low-power',
});
Promise.allSettled([
  // 只留航母的兜底贴图：驱逐舰已经改成三维放样舰体，
  // destroyer.png（781 KB）从 v3 起就没有任何引用，不必再下载。
  preloadTextures({
    carrier: 'assets/carrier.png',
  }),
  preloadFighter('assets/models/f16.glb', probe),
  preloadCarrier('assets/models/carrier.glb'),
]).then(([tex, model, carrier]) => {
  probe.dispose();
  probe.forceContextLoss();   // 及时还掉临时上下文（iOS 同时允许的上下文数量有限）
  if (model.status === 'rejected') {
    console.warn('[小宝特工空战] 战机低模加载失败', model.reason);
  } else {
    console.info('[小宝特工空战] f16.glb（30k PBR）就绪');
  }
  if (carrier.status === 'rejected') {
    console.warn('[小宝特工空战] 航母低模加载失败', carrier.reason);
  } else {
    console.info('[小宝特工空战] carrier.glb 就绪');
  }
  boot(tex.status === 'fulfilled', model.status === 'fulfilled');
});
