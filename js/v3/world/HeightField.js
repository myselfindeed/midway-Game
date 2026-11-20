/**
 * 高度场：离线烘焙的 8bit 灰度 PNG（见 tools/bake-terrain.mjs），运行时只读。
 * 职责：解码 + 双线性采样 + 法线查询 + 区域最高点（用于判断整块是否在水下）。
 */
export class HeightField {
  constructor(meta, data, width, height) {
    this.meta = meta;
    this.data = data;           // Uint8Array, width*height
    this.width = width;
    this.height = height;
    this.half = meta.extent / 2;
    this.originX = meta.center[0] - this.half;
    this.originZ = meta.center[1] - this.half;
    this.minH = meta.minHeight;
    this.maxH = meta.maxHeight;
    this.seaLevel = meta.seaLevel;
    this.range = this.maxH - this.minH;
  }

  /** 世界坐标 → 高度（双线性） */
  heightAt(x, z) {
    const u = ((x - this.originX) / this.meta.extent) * (this.width - 1);
    const v = ((z - this.originZ) / this.meta.extent) * (this.height - 1);
    if (u < 0 || v < 0 || u > this.width - 1 || v > this.height - 1) return this.minH;
    const x0 = u | 0, z0 = v | 0;
    const x1 = Math.min(x0 + 1, this.width - 1);
    const z1 = Math.min(z0 + 1, this.height - 1);
    const fx = u - x0, fz = v - z0;
    const d = this.data, w = this.width;
    const h00 = d[z0 * w + x0], h10 = d[z0 * w + x1];
    const h01 = d[z1 * w + x0], h11 = d[z1 * w + x1];
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return this.minH + ((a + (b - a) * fz) / 255) * this.range;
  }

  /** 是否在地形覆盖范围内 */
  contains(x, z) {
    return (
      x >= this.originX && x <= this.originX + this.meta.extent &&
      z >= this.originZ && z <= this.originZ + this.meta.extent
    );
  }

  /** 中心差分求法线，写入 out（默认单位化） */
  normalAt(x, z, out) {
    const e = this.meta.extent / this.width;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hu = this.heightAt(x, z - e);
    const hd = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hu - hd).normalize();
  }

  /** 区域内最高点（粗采样，用于整块水面剔除） */
  maxHeight(x0, z0, x1, z1, samples = 6) {
    let m = -Infinity;
    for (let j = 0; j <= samples; j++) {
      for (let i = 0; i <= samples; i++) {
        const h = this.heightAt(x0 + ((x1 - x0) * i) / samples, z0 + ((z1 - z0) * j) / samples);
        if (h > m) m = h;
      }
    }
    return m;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`无法加载 ${url}`));
    img.src = url;
  });
}

/** 读取 height.json + height.png，返回 HeightField */
export async function loadHeightField(pngUrl = 'assets/terrain/height.png', metaUrl = 'assets/terrain/height.json') {
  const [metaRes, img] = await Promise.all([fetch(metaUrl), loadImage(pngUrl)]);
  const meta = await metaRes.json();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0, n = data.length; i < n; i++) data[i] = px[i * 4];
  return new HeightField(meta, data, img.width, img.height);
}
