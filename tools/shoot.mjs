/**
 * Headless 截图 / 体检脚本。
 * 用法： node tools/shoot.mjs <out.png> [waitMs] [setupJS]
 *   setupJS 会以 __game 在作用域内执行，可用来摆机位、开关效果。
 * 环境变量： W/H 视口尺寸，QUERY 附加查询串（如 bloom=0），KEEP=1 不杀进程
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// 端口随机：残留的旧 Chrome 实例会占着固定端口，脚本就会连到带旧缓存的进程上，
// 改了代码却拍到上一版画面（排查过一次，很浪费时间）
const PORT = Number(process.env.CDP_PORT || (9300 + Math.floor(Math.random() * 400)));
const OUT = process.argv[2] || 'Docs/screenshots/shot.png';
const WAIT = Number(process.argv[3] || 3500);
import { readFileSync } from 'node:fs';
const SETUP = process.env.SETUP_FILE ? readFileSync(process.env.SETUP_FILE, 'utf8') : (process.argv[4] || '');
const W = Number(process.env.W || 1600);
const H = Number(process.env.H || 900);
const QUERY = process.env.QUERY ? `&${process.env.QUERY}` : '';
const BASE = process.env.BASE || 'http://127.0.0.1:8901';
// 每次用全新 profile：否则 Chrome 会拿磁盘缓存里的旧模块，
// 改了代码却拍到上一版的画面（排查起来极其浪费时间）
const PROFILE = `/tmp/cdp-profile-${process.pid}-${Date.now()}`;
const PAGE = `${BASE}/index.html?debug&cb=${Date.now()}${QUERY}`;

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    '--enable-features=Vulkan',
    `--window-size=${W},${H}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
    `--user-data-dir=${PROFILE}`,
    '--disk-cache-size=1',
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
let chromeErr = '';
proc.stderr.on('data', (d) => {
  chromeErr += d.toString();
});

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`CDP 未就绪\n${chromeErr}`);
}

const wsUrl = await findTarget();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(`[${msg.params.type}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`);
  }
});

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// headless 下页面会被当成"未聚焦"，rAF 被节流到 30fps —— 测帧时间会得到假数据（16ms/33ms 来回跳）
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url: PAGE });

// 等 __game 出现（地形是异步加载的）
let ready = false;
for (let i = 0; i < 100; i++) {
  await sleep(150);
  try {
    ready = await evaluate('!!window.__game');
  } catch {
    /* 页面还在导航 */
  }
  if (ready) break;
}
if (!ready) throw new Error('页面未就绪\n' + logs.join('\n'));

// ?level=N 直达关卡时首页已经被跳过，btnStart 可能不存在
await evaluate('(() => { const b = document.getElementById("btnStart"); if (b) b.click(); return true; })()');
// 首页现在先进「选择关卡」，再进简报；LEVEL 环境变量指定要进哪一关
const LEVEL = Number(process.env.LEVEL || 1);
await sleep(350);
await evaluate(`(() => { const el = document.querySelector('.level-item[data-level="${LEVEL}"]'); if (el && !el.disabled) el.click(); return true; })()`);
// 开场简报是多页的，逐页点掉再进入战斗
await sleep(500);
for (let i = 0; i < 6; i++) {
  const more = await evaluate(`(() => { const b = document.getElementById('btnNext'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`);
  if (!more) break;
  await sleep(350);
}
if (SETUP) await evaluate(`(async () => { const __g = window.__game; ${SETUP} })()`);

await sleep(WAIT);

if (SETUP) await evaluate(`(async () => { const __g = window.__game; ${SETUP} })()`);
await sleep(400);

const info = await evaluate(`(async () => {
  const g = window.__game;
  const r = g.renderer;
  const px = r.getPixelRatio();
  // 采样 40 帧算真实帧时间（headless 下仅供参考）
  const t0 = performance.now();
  await new Promise((res) => { let n = 0; const f = () => { if (++n >= 40) return res(); requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const frameMs = (performance.now() - t0) / 40;
  const rt = g.postfx?.composer?.renderTarget1;
  return JSON.stringify({
    frameMs: +frameMs.toFixed(2),
    calls: r.info.render.calls,
    tris: r.info.render.triangles,
    programs: r.info.programs.length,
    textures: r.info.memory.textures,
    geometries: r.info.memory.geometries,
    pixelRatio: px,
    drawingBuffer: [r.domElement.width, r.domElement.height],
    msaaSamples: rt ? rt.samples : null,
    hdrType: rt ? rt.texture.type : null,
    bloom: g.postfx ? {
      enabled: g.postfx.enabled,
      tier: g.postfx.tier,
      strength: g.postfx.bloom.strength,
      radius: g.postfx.bloom.radius,
      threshold: g.postfx.bloom.threshold,
    } : null,
  });
})()`);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

console.log(info);
if (logs.length) console.log('--- console ---\n' + logs.slice(-25).join('\n'));
console.log('saved ' + OUT);

ws.close();
if (!process.env.KEEP) proc.kill('SIGKILL');
try { const { rmSync } = await import('node:fs'); rmSync(PROFILE, { recursive: true, force: true }); } catch {}
process.exit(0);
