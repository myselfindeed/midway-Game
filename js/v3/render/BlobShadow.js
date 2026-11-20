import * as THREE from 'three';

/**
 * 落地投影（blob shadow）
 *
 * 为什么不用 shadowMap：地形材质是自定义 ShaderMaterial，没有接入 three 的
 * shadowmap chunk，`receiveShadow` 对它完全无效——所以整片地面收不到任何阴影，
 * 飞行器看起来是"悬空"的。给地形着色器补阴影链路成本高、风险大，
 * 而 80% 的观感收益只来自"飞行器下方有一块影子"。
 *
 * 做法：从飞行器沿太阳方向对高度场做步进求交，得到落点；
 * 在那里贴一张乘算（MultiplyBlending）的软圆，尺寸与浓度随离地高度变化。
 */

const SUN_DIR = new THREE.Vector3(-0.55, 0.78, -0.42).normalize();

/** 64² 径向渐变，中间实、边缘散；运行时生成，不额外增加资源文件 */
function makeShadowTexture() {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i + 0.5) / S * 2 - 1;
      const y = (j + 0.5) / S * 2 - 1;
      const r = Math.min(1, Math.hypot(x, y));
      // 中心 0（乘算等于把地面压暗到 0.35），向外平滑回到 1
      const a = THREE.MathUtils.smoothstep(r, 0.15, 1.0);
      const v = Math.round(THREE.MathUtils.lerp(92, 255, a));
      const o = (j * S + i) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createBlobShadow(field, opts = {}) {
  const tex = makeShadowTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.MultiplyBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;         // 地形之后、云之前
  mesh.visible = false;

  const tmp = new THREE.Vector3();
  const baseSize = opts.size ?? 9;

  return {
    mesh,
    /**
     * @param {THREE.Vector3} pos 飞行器位置
     * @param {number} groundY  飞行器正下方的地面高度（用于快速剪枝）
     */
    update(pos, groundY) {
      // 严格按太阳方向投影时，影子会落到机身正后方（太阳在本作画面前方），
      // 追尾相机永远看不到。这里改成"接地影 + 少量向背光侧偏移"：
      // 既有方向感，又保证任何机位都能看到。
      const alt = Math.max(0, pos.y - groundY);
      const k = THREE.MathUtils.clamp(alt / 90, 0, 1);

      // 直接落在正下方：太阳在本作画面前方，任何"按物理背光"的偏移都会
      // 落到相机身后而看不见。接地影是街机游戏的通行做法，读的是"离地高度"。
      const off = alt * 0.10;   // 极轻的前移，避免完全被机身盖住
      const sx = pos.x;
      const sz = pos.z - off;

      const gy = field.heightAt(sx, sz);
      mesh.position.set(sx, gy + 1.2, sz);
      mesh.visible = true;

      const size = baseSize * (1 + k * 1.5);
      mesh.scale.set(size, 1, size * 1.3);   // 顺光方向略拉长
      mat.opacity = THREE.MathUtils.lerp(1.0, 0.38, k);
    },
  };
}
