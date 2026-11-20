import * as THREE from 'three';
import { createTerrainMaterials } from './TerrainMaterial.js';

/**
 * 地形：按块（CHUNK）流式加载，块内按距离选 LOD，边缘加裙边补缝。
 *  - 整块最高点低于海平面 → 不建几何（海面盖住，省 draw call）
 *  - 顶点色承担生物群系着色，贴图承担细节
 */
const CHUNK = 280;
const SKIRT = 7;          // 裙边下探深度（单位），用于遮盖 LOD 缝隙
const SAND_TOP = -12;     // 与海平面 -18 相差 6 单位内才算沙滩（避免内陆低地全变沙）
const RES_NEAR = 40;
const RES_MID = 32;
const RES_FAR = 12;

export class Terrain {
  constructor(scene, field, opts = {}) {
    this.scene = scene;
    this.field = field;
    this.radius = opts.radius ?? 4;
    this.lodDist = opts.lodDist ?? [300, 700];

    const mats = createTerrainMaterials();
    this.materials = mats.list;
    this.material = mats.list[0];   // 单材质：沙/草靠顶点色过渡，避免粗网格上的锯齿分界
    this.materialUniforms = mats.uniforms || null;   // 云影动画由 Game 每帧推进

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    this.chunks = new Map();
    this.castShadow = opts.castShadow !== false;   // 关掉可省一次地形深度 pass（低画质档）
    this.buildBudget = opts.buildBudget ?? 2;   // 每帧最多新建/重建 2 块，避免跨块时掉帧
    this._n = new THREE.Vector3();
    this._c = new THREE.Color();
    this._lastKey = '';
  }

  /** 每帧调用：按玩家位置维护可见块。内部只在块或 LOD 变化时才重建。 */
  update(pos) {
    if (!this.field) return;
    const cx = Math.floor(pos.x / CHUNK);
    const cz = Math.floor(pos.z / CHUNK);
    const r = this.radius;
    // 首帧一次性铺满（避免开局空地），之后每帧限量补块
    const budget = this.chunks.size === 0 ? 64 : this.buildBudget;

    // 1) 收集缺口，按距离由近到远排序，保证每帧的建块预算先花在眼前
    const pending = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        const key = `${ix},${iz}`;
        const centerX = (ix + 0.5) * CHUNK;
        const centerZ = (iz + 0.5) * CHUNK;
        const dist = Math.hypot(centerX - pos.x, centerZ - pos.z);
        let res = dist < this.lodDist[0] ? RES_NEAR : dist < this.lodDist[1] ? RES_MID : RES_FAR;
        const existing = this.chunks.get(key);
        if (existing) {
          // 迟滞：降级要等走远 12% 才生效，升级立即生效，避免边界反复重建
          if (existing.res > res) {
            const thr = (res === RES_FAR ? this.lodDist[1] : this.lodDist[0]) * 1.12;
            if (dist < thr) res = existing.res;
          }
          if (existing.res === res) continue;
        }
        pending.push({ ix, iz, key, res, dist });
      }
    }
    pending.sort((a, b) => a.dist - b.dist);

    const limit = Math.min(pending.length, budget);
    for (let i = 0; i < limit; i++) {
      const { ix, iz, key, res } = pending[i];
      const existing = this.chunks.get(key);
      if (existing) this._dispose(existing);
      this.chunks.set(key, this._build(ix, iz, res));
    }

    // 2) 回收超出环的块（水下空块也一并回收，避免 Map 无限增长）
    for (const [key, chunk] of this.chunks) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.abs(ix - cx) > r || Math.abs(iz - cz) > r) {
        this._dispose(chunk);
        this.chunks.delete(key);
      }
    }
  }

  _dispose(chunk) {
    if (chunk.mesh) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
  }

  _build(ix, iz, res) {
    const f = this.field;
    const x0 = ix * CHUNK;
    const z0 = iz * CHUNK;
    const x1 = x0 + CHUNK;
    const z1 = z0 + CHUNK;

    // 整块在水下 → 交给海面
    if (f.maxHeight(x0, z0, x1, z1, 6) < f.seaLevel - 1) {
      return { mesh: null, res, key: `${ix},${iz}` };
    }

    const n = res + 1;
    const step = CHUNK / res;
    const vertCount = n * n;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const colors = new Float32Array(vertCount * 3);
    const sandVals = new Float32Array(vertCount);   // 0=植被 1=沙滩，交给着色器混合

    const nrm = this._n;
    const col = this._c;

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const vi = j * n + i;
        const x = x0 + i * step;
        const z = z0 + j * step;
        const y = f.heightAt(x, z);
        positions[vi * 3] = x;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = z;
        f.normalAt(x, z, nrm);
        normals[vi * 3] = nrm.x;
        normals[vi * 3 + 1] = nrm.y;
        normals[vi * 3 + 2] = nrm.z;
        uvs[vi * 2] = x;
        uvs[vi * 2 + 1] = z;

        sandVals[vi] = THREE.MathUtils.clamp((f.seaLevel + 18 - y) / 26, 0, 1);
        this._biomeColor(y, nrm.y, x, z, col);
        colors[vi * 3] = col.r;
        colors[vi * 3 + 1] = col.g;
        colors[vi * 3 + 2] = col.b;
      }
    }

    const idx = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    // 裙边：外扩一圈下探顶点，遮住相邻块 LOD 不一致产生的缝隙
    const skirtBase = vertCount;
    const edges = [];
    for (let i = 0; i < n; i++) edges.push(i);                        // j = 0
    for (let i = 0; i < n; i++) edges.push(res * n + i);               // j = res
    for (let j = 1; j < res; j++) edges.push(j * n);                   // i = 0
    for (let j = 1; j < res; j++) edges.push(j * n + res);             // i = res

    const skirtPos = new Float32Array(edges.length * 3);
    const skirtNrm = new Float32Array(edges.length * 3);
    const skirtUv = new Float32Array(edges.length * 2);
    const skirtCol = new Float32Array(edges.length * 3);
    const skirtSand = new Float32Array(edges.length);
    for (let k = 0; k < edges.length; k++) {
      const src = edges[k];
      skirtPos[k * 3] = positions[src * 3];
      skirtPos[k * 3 + 1] = positions[src * 3 + 1] - SKIRT;
      skirtPos[k * 3 + 2] = positions[src * 3 + 2];
      skirtNrm[k * 3] = normals[src * 3];
      skirtNrm[k * 3 + 1] = normals[src * 3 + 1];
      skirtNrm[k * 3 + 2] = normals[src * 3 + 2];
      skirtUv[k * 2] = uvs[src * 2];
      skirtUv[k * 2 + 1] = uvs[src * 2 + 1];
      skirtCol[k * 3] = colors[src * 3];
      skirtCol[k * 3 + 1] = colors[src * 3 + 1];
      skirtCol[k * 3 + 2] = colors[src * 3 + 2];
      skirtSand[k] = sandVals[src];
    }
    const perEdge = [n, n, res - 1, res - 1];
    let offset = 0;
    for (const count of perEdge) {
      for (let k = 0; k < count - 1; k++) {
        const a = edges[offset + k];
        const b = edges[offset + k + 1];
        const sa = skirtBase + offset + k;
        const sb = sa + 1;
        // 双面写入，避免裙边朝向导致被剔除
        idx.push(a, sa, b, b, sa, sb);
        idx.push(a, b, sa, b, sb, sa);
      }
      offset += count;
    }

    const total = vertCount + edges.length;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const clr = new Float32Array(total * 3);
    const sandAll = new Float32Array(total);
    pos.set(positions); pos.set(skirtPos, vertCount * 3);
    nor.set(normals); nor.set(skirtNrm, vertCount * 3);
    uv.set(uvs); uv.set(skirtUv, vertCount * 2);
    clr.set(colors); clr.set(skirtCol, vertCount * 3);
    sandAll.set(sandVals); sandAll.set(skirtSand, vertCount);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    geo.setAttribute('aSand', new THREE.BufferAttribute(sandAll, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(0, 0, 0);
    mesh.receiveShadow = true;
    // 地形必须自己也投射阴影，否则山体之间没有互相投影，山谷永远是平的
    mesh.castShadow = this.castShadow;
    this.group.add(mesh);
    return { mesh, res, key: `${ix},${iz}` };
  }

  /** 顶点色：只做亮度扰动与陡坡偏岩；沙滩已交给 aSand 属性在着色器里混 */
  _biomeColor(h, ny, x, z, out) {
    const steep = THREE.MathUtils.clamp((0.86 - ny) / 0.32, 0, 1);
    const macro =
      0.92 +
      0.08 * Math.sin(x * 0.0137 + z * 0.0071) +
      0.05 * Math.sin(z * 0.0193 - x * 0.0114 + 1.7) +
      0.03 * Math.sin(x * 0.041 + z * 0.033);

    const grassT = THREE.MathUtils.clamp((h - 6) / 44, 0, 1);
    let r = 1.00 - 0.05 * grassT;
    let g = 1.00 - 0.02 * grassT;
    let b = 0.96 + 0.04 * grassT;

    if (steep > 0) {
      r = THREE.MathUtils.lerp(r, 0.96, steep);
      g = THREE.MathUtils.lerp(g, 0.93, steep);
      b = THREE.MathUtils.lerp(b, 0.90, steep);
    }
    out.setRGB(r * macro, g * macro, b * macro);
    return out;
  }

  /** 地面高度查询（供碰撞/软地板使用） */
  heightAt(x, z) {
    return this.field ? this.field.heightAt(x, z) : -Infinity;
  }

  dispose() {
    for (const chunk of this.chunks.values()) this._dispose(chunk);
    this.chunks.clear();
    this.scene.remove(this.group);
    this.materials.forEach((m) => {
      if (m.map) m.map.dispose();
      if (m.normalMap) m.normalMap.dispose();
      m.dispose();
    });
  }
}
