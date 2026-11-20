import * as THREE from 'three';

/**
 * 远山：环比山脊带（径向剖面有上升和下降坡面，不是一圈竖墙）。
 *
 * 前两版的失败：
 *   ① 竖直剪影带 → 高空俯视看到内壁，像漂浮的浅蓝平台；
 *   ② 三圈同心圆、内圈贴着水面 → 从低空看是一条平的浅色板，不像山。
 * 这一版沿半径铺 8 圈剖面（0 → 峰 → 0），每个方向的山脊高度不同，
 * 颜色按圈向雾色靠拢，用颜色而不是几何表达"远"。
 *
 * 另外：内圈半径必须大于地形环半径（±1260，对角 1780），否则山会从地里长出来。
 */

const MOUNTAIN = new THREE.Color(0x3d5a63);
const PEAK = 210;

// [半径, 高度系数, 雾色混合比例]
const PROFILE = [
  [1780, 0.00, 0.60],
  [1980, 0.45, 0.64],
  [2280, 0.80, 0.70],
  [2680, 1.00, 0.75],
  [3150, 0.88, 0.81],
  [3750, 0.62, 0.87],
  [4500, 0.34, 0.92],
  [5400, 0.00, 0.96],
];

const SEG = 160;

/** 某个方向的山脊系数：多频正弦叠加，不要用迭代平滑（绕一圈会被平均成常数） */
function ridgeAt(a, phase) {
  const n =
    0.44 +
    0.22 * Math.sin(a * 2.3 + phase) +
    0.17 * Math.sin(a * 5.9 + phase * 1.7 + 2.2) +
    0.11 * Math.sin(a * 11.3 + phase * 0.6 + 4.1) +
    0.06 * Math.sin(a * 21.7 + phase * 2.3 + 1.0);
  return Math.min(1, Math.max(0.06, n));
}

export function createFarRange(fogColor = 0xc3dae7) {
  const group = new THREE.Group();
  group.name = 'farRange';
  const fog = new THREE.Color(fogColor);

  const pos = [];
  const col = [];

  for (let ri = 0; ri < PROFILE.length; ri++) {
    const [radius, hScale, tint] = PROFILE[ri];
    const c = fog.clone().lerp(MOUNTAIN, tint);
    // 每一圈的山脊相位错开，避免各圈轮廓完全平行
    const phase = ri * 1.37;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const h = PEAK * hScale * ridgeAt(a, phase) + 8;
      pos.push(Math.cos(a) * radius, h, Math.sin(a) * radius);
      // 峰顶略亮一点，谷底略暗，增加体积感
      const shade = 0.92 + 0.14 * hScale;
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }

  const idx = [];
  for (let ri = 0; ri < PROFILE.length - 1; ri++) {
    const base = ri * (SEG + 1);
    const next = (ri + 1) * (SEG + 1);
    for (let i = 0; i < SEG; i++) {
      const a = base + i;
      const b = base + i + 1;
      const c = next + i;
      const d = next + i + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: false,
      side: THREE.DoubleSide,
      depthWrite: true,
    })
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;   // 晚于天空（-1000），早于地形
  group.add(mesh);
  return group;
}
