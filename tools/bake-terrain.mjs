/**
 * 烘焙地形高度场（离线，运行时只读 PNG）
 *
 * 产出：
 *   assets/terrain/height.png   1024² 8bit 灰度，高度线性映射 MIN_H..MAX_H
 *   assets/terrain/height.json  元数据（范围 / 尺寸 / 世界范围 / 海岸线）
 *   /tmp/terrain-preview.png    着色预览（仅供人眼验收，不进包）
 *
 * 用法：node tools/bake-terrain.mjs
 *
 * 设计尺度：1 世界单位 ≈ 3.45 m（由 carrier 330m → 95.7 单位推出）
 *   陆地高度 4–62 单位（14–214 m），远山最高约 90 单位（310 m）
 *   海岸线 z ≈ -380，向 -z 方向为内陆
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 1024;
const EXTENT = 2560;                 // 世界单位，覆盖 8.8 km
const CENTER = [0, -560];            // 世界 x,z
const MIN_H = -40;
const MAX_H = 130;
const SEA = -18;                     // 海平面（与 createOcean 一致）

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
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function sstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 地形函数 ----------
/** 海岸线 z 坐标（land 在更负的一侧） */
function coastZ(x) {
  const base = -380 + 210 * Math.sin(x / 980) + 90 * Math.sin(x / 300 + 2.1);
  const detail = 110 * (vnoise(x / 240, 3.7, 41) - 0.5) * 2;
  const bay = 190 * Math.exp(-Math.pow((x - 340) / 300, 2)); // 一处天然海湾
  return base + detail - bay;
}
/** 主河道中心线（短周期 + 高振幅 = 蜿蜒） */
function riverX(z) {
  return 280 * Math.sin((z + 900) / 330) + 110 * Math.sin((z + 200) / 125) + 40;
}

function heightAt(x, z) {
  // 1) 基础丘陵：域扭曲 + fBm + ridged（骨骼感）
  const wx = x + 170 * (vnoise(x / 950, z / 950, 7) - 0.5) * 2;
  const wz = z + 170 * (vnoise(x / 950 + 5.2, z / 950 + 1.3, 9) - 0.5) * 2;
  const hills = fbm(wx / 1050, wz / 1050, 5, 3);
  const mid = fbm(wx / 420, wz / 420, 4, 13);
  const ridge = 1 - Math.abs(fbm(wx / 620, wz / 620, 4, 21) * 2 - 1);
  const ridge2 = 1 - Math.abs(fbm(wx / 240, wz / 240, 3, 61) * 2 - 1);

  // 2) 海岸过渡：sea → 陆地
  const inland = sstep(0, 110, coastZ(x) - z);
  const landH = 3 + Math.pow(hills, 1.15) * 40 + mid * mid * 12 + Math.pow(ridge, 2) * 9 + ridge2 * ridge2 * 3;
  let y = lerp(-34, landH, inland);

  // 3) 远山（地图远端抬升，作为地平线背景）
  const far = sstep(-1560, -1900, z);
  y += far * (34 + 46 * fbm(x / 700, z / 700, 4, 33));

  // 4) 河谷：V 形下切 + 河床低于海平面（水面自然显现）
  const reach = sstep(-300, -560, z) * sstep(-1700, -1500, z);
  const d = Math.abs(x - riverX(z));
  const valley = reach * (1 - sstep(0, 260, d));
  y -= valley * 16;
  y -= reach * 34 * (1 - sstep(0, 110, d));

  // 5) 农田平整：仅在缓坡带做很轻的平台化（梯田交给贴图，不交给高度场）
  const band = sstep(5, 16, y) * (1 - sstep(38, 54, y));
  const farmMask = sstep(0.42, 0.60, fbm(x / 720, z / 720, 3, 91));
  const flat = band * farmMask * inland * (1 - valley);
  y = lerp(y, Math.floor(y / 7) * 7 + 3.5, clamp01(flat) * 0.22);

  // 6) 细腻起伏
  y += (fbm(x / 210, z / 210, 3, 77) - 0.5) * 4.2 * inland;
  return y;
}

// ---------- 采样成图 ----------
const heights = new Float32Array(SIZE * SIZE);
for (let j = 0; j < SIZE; j++) {
  for (let i = 0; i < SIZE; i++) {
    const x = CENTER[0] + (i / (SIZE - 1) - 0.5) * EXTENT;
    const z = CENTER[1] + (j / (SIZE - 1) - 0.5) * EXTENT;
    heights[j * SIZE + i] = heightAt(x, z);
  }
}

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
function encodePNG(w, h, colorType, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;          // bit depth
  ihdr[9] = colorType;  // 0=gray 6=RGBA
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), Buffer.from(r)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 高度图（灰度）
const grayRows = [];
let hMin = Infinity, hMax = -Infinity;
for (let j = 0; j < SIZE; j++) {
  const row = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) {
    const v = heights[j * SIZE + i];
    hMin = Math.min(hMin, v); hMax = Math.max(hMax, v);
    row[i] = Math.round(clamp01((v - MIN_H) / (MAX_H - MIN_H)) * 255);
  }
  grayRows.push(row);
}

// 着色预览（带简易光照，仅用于人眼判断形态）
const sun = [-0.55, 0.72, -0.42];
const sunLen = Math.hypot(...sun);
const sN = sun.map((v) => v / sunLen);
const px = EXTENT / (SIZE - 1);
const prevRows = [];
for (let j = 0; j < SIZE; j++) {
  const row = Buffer.alloc(SIZE * 4);
  for (let i = 0; i < SIZE; i++) {
    const h = heights[j * SIZE + i];
    const hl = heights[j * SIZE + Math.max(0, i - 1)];
    const hr = heights[j * SIZE + Math.min(SIZE - 1, i + 1)];
    const hu = heights[Math.max(0, j - 1) * SIZE + i];
    const hd = heights[Math.min(SIZE - 1, j + 1) * SIZE + i];
    const nx = (hl - hr) / (2 * px), nz = (hu - hd) / (2 * px);
    const nl = Math.hypot(nx, 1, nz);
    const lam = Math.max(0, (nx * sN[0] + 1 * sN[1] + nz * sN[2]) / nl);
    const shade = 0.42 + lam * 0.78;

    let c;
    if (h < SEA) {
      const t = clamp01((SEA - h) / 22);
      c = [lerp(126, 46, t), lerp(154, 96, t), lerp(150, 116, t)];
      c = c.map((v) => v * 0.95);
    } else if (h < SEA + 5) {
      c = [214, 203, 170];
    } else {
      const g = clamp01((h - 4) / 34);
      const rock = clamp01((h - 34) / 26);
      c = [
        lerp(lerp(150, 104, g), 138, rock),
        lerp(lerp(168, 132, g), 132, rock),
        lerp(lerp(96, 66, g), 120, rock),
      ];
    }
    const k = i * 4; // 行内偏移（row 是单行 buffer）
    row[k] = Math.min(255, c[0] * shade);
    row[k + 1] = Math.min(255, c[1] * shade);
    row[k + 2] = Math.min(255, c[2] * shade);
    row[k + 3] = 255;
  }
  prevRows.push(row);
}

mkdirSync('assets/terrain', { recursive: true });
writeFileSync('assets/terrain/height.png', encodePNG(SIZE, SIZE, 0, grayRows));
writeFileSync('/tmp/terrain-preview.png', encodePNG(SIZE, SIZE, 6, prevRows));
writeFileSync(
  'assets/terrain/height.json',
  JSON.stringify(
    {
      size: SIZE,
      minHeight: MIN_H,
      maxHeight: MAX_H,
      seaLevel: SEA,
      extent: EXTENT,
      center: CENTER,
      actualRange: [Number(hMin.toFixed(1)), Number(hMax.toFixed(1))],
      coastlineZ: -380,
    },
    null,
    2
  )
);

console.log(`height.png  ${SIZE}²  高度实测 ${hMin.toFixed(1)} .. ${hMax.toFixed(1)} 单位`);
console.log(`世界范围 x/z: ${(CENTER[0] - EXTENT / 2).toFixed(0)} .. ${(CENTER[0] + EXTENT / 2).toFixed(0)} / ${(CENTER[1] - EXTENT / 2).toFixed(0)} .. ${(CENTER[1] + EXTENT / 2).toFixed(0)}`);
console.log('预览: /tmp/terrain-preview.png');
