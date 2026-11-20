/**
 * 闪烁诊断：连拍多帧，逐帧解码 PNG，输出整体亮度序列与 8×8 网格的亮度波动。
 * 用法： SETUP_FILE=/tmp/freeze.js node tools/flicker.mjs [帧数] [间隔ms]
 * 依赖：无（自带最小 PNG 解码，只处理 8-bit RGB/RGBA 非隔行，正好是 CDP 截图的格式）
 */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 400);
const W = Number(process.env.W || 960);
const H = Number(process.env.H || 540);
const N = Number(process.argv[2] || 12);
const GAP = Number(process.argv[3] || 120);
const OUTDIR = process.env.OUTDIR || '/tmp/flicker';
const SETUP = process.env.SETUP_FILE ? readFileSync(process.env.SETUP_FILE, 'utf8') : '';
const PROFILE = `/tmp/cdp-flicker-${process.pid}-${Date.now()}`;
const PAGE = `http://127.0.0.1:8901/index.html?debug&cb=${Date.now()}`;

function decodePNG(buf) {
  let off = 8;
  let w = 0, h = 0, colorType = 6, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}

const proc = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu-sandbox',
  '--use-gl=angle', '--use-angle=metal',
  '--enable-unsafe-swiftshader',
  `--window-size=${W},${H}`,
  '--force-device-scale-factor=1',
  '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let cerr = '';
proc.stderr.on('data', (d) => { cerr += d; });

let wsUrl = null;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null;
  } catch { /* wait */ }
  await sleep(150);
}
if (!wsUrl) throw new Error('CDP 未就绪\n' + cerr.slice(0, 500));

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url: PAGE });

for (let i = 0; i < 120; i++) {
  await sleep(150);
  if (await evaluate('!!window.__game').catch(() => false)) break;
}
await evaluate('document.getElementById("btnStart").click(), true');
await sleep(500);
for (let i = 0; i < 6; i++) {
  const more = await evaluate(`(() => { const b = document.getElementById('btnNext'); if (!b || !b.offsetParent) return false; b.click(); return true; })()`);
  if (!more) break;
  await sleep(350);
}
if (SETUP) await evaluate(`(async () => { const __g = window.__game; ${SETUP} })()`);
await sleep(1500);

mkdirSync(OUTDIR, { recursive: true });
const frames = [];
for (let i = 0; i < N; i++) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  writeFileSync(`${OUTDIR}/f${String(i).padStart(2, '0')}.png`, buf);
  frames.push(decodePNG(buf));
  await sleep(GAP);
}

// ---- 分析 ----
const GW = 8, GH = 8;
const grid = (f) => {
  const g = new Float64Array(GW * GH);
  const cnt = new Float64Array(GW * GH);
  for (let y = 0; y < f.h; y++) {
    const gy = Math.min(GH - 1, Math.floor((y / f.h) * GH));
    for (let x = 0; x < f.w; x++) {
      const gx = Math.min(GW - 1, Math.floor((x / f.w) * GW));
      const i = (y * f.w + x) * f.ch;
      const lum = f.data[i] * 0.299 + f.data[i + 1] * 0.587 + f.data[i + 2] * 0.114;
      const k = gy * GW + gx;
      g[k] += lum; cnt[k]++;
    }
  }
  for (let k = 0; k < g.length; k++) g[k] /= cnt[k] || 1;
  return g;
};

const grids = frames.map(grid);
const globalLum = grids.map((g) => g.reduce((a, b) => a + b, 0) / g.length);

console.log('帧数', frames.length, '分辨率', `${frames[0].w}x${frames[0].h}`);
console.log('整体亮度序列:', globalLum.map((v) => v.toFixed(2)).join(' '));
const mean = globalLum.reduce((a, b) => a + b, 0) / globalLum.length;
const dev = globalLum.map((v) => ((v - mean) / mean) * 100);
console.log('相对均值偏差%:', dev.map((v) => v.toFixed(2)).join(' '));
console.log('整体波动峰峰值:', (Math.max(...globalLum) - Math.min(...globalLum)).toFixed(2));

// 每个格子的时间标准差，找出最不稳定的区域
const cells = [];
for (let k = 0; k < GW * GH; k++) {
  const vals = grids.map((g) => g[k]);
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
  cells.push({ k, m, sd, cv: (sd / (m || 1)) * 100 });
}
cells.sort((a, b) => b.cv - a.cv);
console.log('波动最大的 6 个网格（行,列 / 均值 / 变异系数%）:');
cells.slice(0, 6).forEach((c) => {
  const r = Math.floor(c.k / GW), col = c.k % GW;
  console.log(`  [${r},${col}] mean=${c.m.toFixed(1)} cv=${c.cv.toFixed(2)}%`);
});

ws.close();
proc.kill('SIGKILL');
try { const { rmSync } = await import('node:fs'); rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
