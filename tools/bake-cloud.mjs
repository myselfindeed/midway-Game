/**
 * 云贴图离线烘焙（零依赖，自带 PNG 编码）
 *
 * 产出两张：
 *   assets/textures/cloud-puff.png  256² 单朵积云（R=明暗，A=轮廓）
 *   assets/textures/cloud-sea.png   1024² 可无缝平铺的云海（R=明暗，A=覆盖）
 *
 * 为什么离线烘：运行时用噪声算云轮廓要多写一遍噪声库，而且首帧会卡；
 * 烘成贴图后运行时只采样，安卓低端机也扛得住。
 *
 * 用法：node tools/bake-cloud.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// ---------- 噪声 ----------
function hash2(i, j, seed = 0) {
  let n = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 可无缝平铺的 value noise：格点索引按 period 取模 */
function vnoiseTiled(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const m = (n) => ((n % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed);
  const b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed);
  const d = hash2(m(xi + 1), m(yi + 1), seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, oct = 5, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function fbmTiled(x, y, oct, period, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  let p = period;
  for (let i = 0; i < oct; i++) {
    sum += vnoiseTiled(x * freq, y * freq, Math.max(1, Math.round(p * freq)), seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function sstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePNG(w, h, colorType, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;          // bit depth
  ihdr[9] = colorType;  // 6 = RGBA
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('assets/textures', { recursive: true });

// ---------- 1) 单朵积云 ----------
// 做法：metaball 叠加（7 个小球取并集）→ 花椰菜轮廓；再用 fbm 咬边 + 顶部受光明暗。
function bakePuff(SIZE = 256) {
  //      x       y      r     权重
  const BLOBS = [
    [0.00, 0.02, 0.34, 1.00],   // 主体
    [-0.30, -0.10, 0.26, 0.92], // 左肩
    [0.32, -0.06, 0.24, 0.90],  // 右肩
    [-0.14, -0.32, 0.22, 0.84], // 左上顶
    [0.18, -0.30, 0.20, 0.80],  // 右上顶
    [-0.36, 0.22, 0.20, 0.72],  // 左下
    [0.30, 0.24, 0.22, 0.74],   // 右下
    [0.00, 0.32, 0.30, 0.68],   // 底部（扁平）
  ];

  const rows = [];
  for (let j = 0; j < SIZE; j++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    row[0] = 0;
    for (let i = 0; i < SIZE; i++) {
      const nx = (i + 0.5) / SIZE * 2 - 1;
      const ny = (j + 0.5) / SIZE * 2 - 1;

      // 1) metaball：取并集（1 - d²/r² 的最大值），平滑融合
      let field = 0;
      for (const [bx, by, br, bw] of BLOBS) {
        const d2 = ((nx - bx) ** 2 + (ny - by) ** 2) / (br * br);
        const f = (1 - d2) * bw;
        if (f > field) field = f;
      }

      // 2) 咬边：噪声吃掉轮廓，避免光滑胶状
      const bite = fbm(nx * 4.6 + 7.3, ny * 4.6 + 2.9, 4, 91) - 0.5;
      field += bite * 0.30;

      // 3) 底部压平（积云底）
      if (ny > 0.30) field -= (ny - 0.30) * 1.9;

      let a = sstep(0.02, 0.24, field);
      // 外圈柔和衰减，避免硬边
      const rr = Math.hypot(nx, ny);
      a *= sstep(1.02, 0.55, rr);
      a = clamp01(a);

      // 4) 明暗：顶部受光、底部偏冷暗；叠团块噪声
      const lump = fbm(nx * 3.6 + 1.7, ny * 3.6 + 5.1, 4, 33);
      const vert = clamp01(0.5 - ny * 0.55);           // 1=顶 0=底
      let shade = 0.34 + 0.52 * vert + 0.26 * (lump - 0.5) * 2 * 0.5;
      // 边缘稍暗，形成体积感（球面法线近似）
      shade -= 0.16 * clamp01(rr * rr * 0.9);
      shade = clamp01(shade);

      const o = 1 + i * 4;
      row[o] = Math.round(shade * 255);
      row[o + 1] = Math.round(shade * 255);
      row[o + 2] = Math.round(shade * 255);
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  const png = encodePNG(SIZE, SIZE, 6, rows);
  writeFileSync('assets/textures/cloud-puff.png', png);
  console.log('cloud-puff.png', SIZE + '²', (png.length / 1024).toFixed(0) + 'KB');
}

// ---------- 2) 云海（可平铺） ----------
function bakeSea(SIZE = 1024) {
  const rows = [];
  const CELL = 12;   // 平铺格数：SIZE/CELL 决定噪声基频
  for (let j = 0; j < SIZE; j++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    row[0] = 0;
    for (let i = 0; i < SIZE; i++) {
      const u = i / SIZE, v = j / SIZE;
      // 域扭曲，让云带不规则
      const wx = u + 0.09 * (fbmTiled(u * 3, v * 3, 3, 3, 7) - 0.5) * 2;
      const wy = v + 0.09 * (fbmTiled(u * 3 + 5.2, v * 3 + 1.3, 3, 3, 9) - 0.5) * 2;

      const n = fbmTiled(wx * CELL, wy * CELL, 5, CELL, 21);
      const big = fbmTiled(wx * 2.2, wy * 2.2, 3, 3, 55);   // 大尺度疏密（云团聚集/空隙）

      let a = sstep(0.46, 0.70, n) * sstep(0.34, 0.62, big);
      a = clamp01(a * 1.15);

      const shade = clamp01(0.30 + 0.75 * n + 0.16 * (1 - v));
      const o = 1 + i * 4;
      row[o] = Math.round(shade * 255);
      row[o + 1] = Math.round(shade * 255);
      row[o + 2] = Math.round(shade * 255);
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  const png = encodePNG(SIZE, SIZE, 6, rows);
  writeFileSync('assets/textures/cloud-sea.png', png);
  console.log('cloud-sea.png', SIZE + '²', (png.length / 1024).toFixed(0) + 'KB');
}

bakePuff();
bakeSea();
