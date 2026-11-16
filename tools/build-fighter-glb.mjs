/**
 * Original low-poly modern fighter (not a copy of any real type).
 * Game scale: nose = -Z, up = +Y, right = +X.
 * One 1024 JPEG atlas embedded in a glTF 2.0 binary (.glb).
 *
 *   node tools/build-fighter-glb.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../assets/models/fighter.glb');

/** Meters → game units. ~16.4 m jet becomes ~6.7 units long (chase cam ~12). */
const S = 0.41;
const SEG = 22;

const ATLAS = {
  fuse:   { u0: 0.015, u1: 0.495, v0: 0.50, v1: 0.985 },
  wingT:  { u0: 0.515, u1: 0.985, v0: 0.62, v1: 0.985 },
  wingB:  { u0: 0.515, u1: 0.985, v0: 0.30, v1: 0.595 },
  tail:   { u0: 0.015, u1: 0.25,  v0: 0.04, v1: 0.47 },
  stab:   { u0: 0.265, u1: 0.495, v0: 0.04, v1: 0.27 },
  nozzle: { u0: 0.265, u1: 0.495, v0: 0.29, v1: 0.475 },
  glass:  { u0: 0.515, u1: 0.735, v0: 0.025, v1: 0.275 },
  metal:  { u0: 0.755, u1: 0.985, v0: 0.025, v1: 0.27 },
  missile:{ u0: 0.755, u1: 0.985, v0: 0.29, v1: 0.475 },
};

function uvIn(rect, su, sv) {
  return [
    rect.u0 + (rect.u1 - rect.u0) * clamp01(su),
    rect.v0 + (rect.v1 - rect.v0) * clamp01(sv),
  ];
}
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function lerp(a, b, t) { return a + (b - a) * t; }
function P(x, y, z) { return [x * S, y * S, z * S]; }

class Geo {
  constructor() {
    this.verts = [];
    this.indices = [];
  }
  v(p, uv) {
    const i = this.verts.length;
    this.verts.push({ p, uv: uv || [0.5, 0.5], n: [0, 1, 0] });
    return i;
  }
  tri(a, b, c) {
    const pa = this.verts[a].p, pb = this.verts[b].p, pc = this.verts[c].p;
    const abx = pb[0] - pa[0], aby = pb[1] - pa[1], abz = pb[2] - pa[2];
    const acx = pc[0] - pa[0], acy = pc[1] - pa[1], acz = pc[2] - pa[2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    if (cx * cx + cy * cy + cz * cz < 1e-16) return;
    this.indices.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  flip() {
    for (let i = 0; i < this.indices.length; i += 3) {
      const t = this.indices[i + 1];
      this.indices[i + 1] = this.indices[i + 2];
      this.indices[i + 2] = t;
    }
  }
  /** Flip the whole part if faces mostly point toward the centroid. */
  orientOutward() {
    if (this.indices.length < 3 || this.verts.length === 0) return;
    let cx = 0, cy = 0, cz = 0;
    for (const v of this.verts) { cx += v.p[0]; cy += v.p[1]; cz += v.p[2]; }
    const n = this.verts.length;
    cx /= n; cy /= n; cz /= n;
    let score = 0;
    for (let i = 0; i < this.indices.length; i += 3) {
      const a = this.verts[this.indices[i]].p;
      const b = this.verts[this.indices[i + 1]].p;
      const c = this.verts[this.indices[i + 2]].p;
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const mx = (a[0] + b[0] + c[0]) / 3 - cx;
      const my = (a[1] + b[1] + c[1]) / 3 - cy;
      const mz = (a[2] + b[2] + c[2]) / 3 - cz;
      score += nx * mx + ny * my + nz * mz;
    }
    if (score < 0) this.flip();
  }
  computeNormals(creaseDeg = 46) {
    const cosT = Math.cos((creaseDeg * Math.PI) / 180);
    const faces = [];
    for (let i = 0; i < this.indices.length; i += 3) {
      const ia = this.indices[i], ib = this.indices[i + 1], ic = this.indices[i + 2];
      const a = this.verts[ia].p, b = this.verts[ib].p, c = this.verts[ic].p;
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      faces.push({ nx, ny, nz, ia, ib, ic, area: len * 0.5 });
    }
    const vfaces = Array.from({ length: this.verts.length }, () => []);
    faces.forEach((f, fi) => {
      vfaces[f.ia].push(fi);
      vfaces[f.ib].push(fi);
      vfaces[f.ic].push(fi);
    });
    const out = [];
    const remap = faces.map(() => ({}));
    for (let vi = 0; vi < this.verts.length; vi++) {
      const flist = vfaces[vi];
      if (flist.length === 0) continue;
      const parent = flist.map((_, i) => i);
      const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
      };
      const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
      for (let i = 0; i < flist.length; i++) {
        for (let j = i + 1; j < flist.length; j++) {
          const A = faces[flist[i]], B = faces[flist[j]];
          if (A.nx * B.nx + A.ny * B.ny + A.nz * B.nz >= cosT) union(i, j);
        }
      }
      const rootTo = new Map();
      for (let i = 0; i < flist.length; i++) {
        const r = find(i);
        if (!rootTo.has(r)) {
          let nx = 0, ny = 0, nz = 0;
          for (let k = 0; k < flist.length; k++) {
            if (find(k) !== r) continue;
            const f = faces[flist[k]];
            nx += f.nx * f.area; ny += f.ny * f.area; nz += f.nz * f.area;
          }
          const l = Math.hypot(nx, ny, nz) || 1;
          const src = this.verts[vi];
          rootTo.set(r, out.length);
          out.push({ p: src.p, uv: src.uv, n: [nx / l, ny / l, nz / l] });
        }
      }
      for (let i = 0; i < flist.length; i++) {
        const fi = flist[i];
        const f = faces[fi];
        const ni = rootTo.get(find(i));
        if (f.ia === vi) remap[fi].a = ni;
        else if (f.ib === vi) remap[fi].b = ni;
        else remap[fi].c = ni;
      }
    }
    const indices = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const r = remap[fi];
      if (r.a == null || r.b == null || r.c == null) continue;
      indices.push(r.a, r.b, r.c);
    }
    this.verts = out;
    this.indices = indices;
  }
}

function merge(parts) {
  const g = new Geo();
  for (const src of parts) {
    if (!src || src.indices.length === 0) continue;
    const base = g.verts.length;
    for (const v of src.verts) g.verts.push({ p: v.p.slice(), uv: v.uv.slice(), n: v.n.slice() });
    for (const i of src.indices) g.indices.push(i + base);
  }
  return g;
}

function finalize(geo, name) {
  geo.orientOutward();
  geo.computeNormals(name === 'glass' ? 62 : 40);
  const tris = geo.indices.length / 3;
  let maxX = -1e9, nx = 0, maxY = -1e9, ny = 0;
  for (const v of geo.verts) {
    if (v.p[0] > maxX) { maxX = v.p[0]; nx = v.n[0]; }
    if (v.p[1] > maxY) { maxY = v.p[1]; ny = v.n[1]; }
  }
  console.log(`  ${name.padEnd(10)} ${String(tris).padStart(5)} tris   n@+X ${nx.toFixed(2)}   n@+Y ${ny.toFixed(2)}`);
  return geo;
}

function airfoil(c) {
  const x = clamp01(c);
  const yt = 0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x;
  return yt / 0.1;
}

function wingStation(s) {
  const x = lerp(0.55, 6.15, s);
  const kink = 0.28;
  let zLe, zTe;
  if (s < kink) {
    const t = s / kink;
    zLe = lerp(-1.15, -0.35, t);
    zTe = lerp(3.15, 2.85, t);
  } else {
    const t = (s - kink) / (1 - kink);
    const ts = t * t * (3 - 2 * t);
    zLe = lerp(-0.35, 2.55, ts);
    zTe = lerp(2.85, 3.35, t);
  }
  // Dogtooth: a small forward notch where sweep increases.
  const d = Math.abs(s - kink);
  if (d < 0.035) zLe -= (1 - d / 0.035) * 0.28;
  const y = lerp(0.06, -0.24, s);
  const thick = lerp(0.26, 0.05, s);
  return { x, y, zLe, zTe, thick };
}

/**
 * Airfoil panel. span 0..1, chord 0 LE → 1 TE.
 * spanAxis 'x' (wing/stab) or 'y' (fin, before cant).
 */
function addAirfoil(opts) {
  const {
    spanN = 10,
    chordN = 14,
    station,
    uvTop,
    uvBot,
    side = 1,
    deflect = 0,
    hingeC = 0.72,
  } = opts;
  const g = new Geo();
  const up = [], lo = [], mid = [];
  for (let i = 0; i <= spanN; i++) {
    const s = i / spanN;
    const st = station(s);
    up[i] = []; lo[i] = []; mid[i] = [];
    for (let j = 0; j <= chordN; j++) {
      const c = 0.5 * (1 - Math.cos((j / chordN) * Math.PI));
      const z = lerp(st.zLe, st.zTe, c);
      const th = airfoil(c) * st.thick;
      let y = st.y;
      let zc = z;
      if (deflect !== 0 && c > hingeC) {
        const hz = lerp(st.zLe, st.zTe, hingeC);
        const hy = st.y;
        const dz = z - hz;
        const dy = 0;
        const ca = Math.cos(deflect), sa = Math.sin(deflect);
        // RotX: raise/lower TE. Negative angle lifts TE (see build notes).
        y = hy + dy * ca - dz * sa;
        zc = hz + dy * sa + dz * ca;
      }
      const x = st.x * side;
      const u = s;
      const edge = j === 0 || j === chordN;
      if (edge) {
        mid[i][j] = g.v(P(x, y, zc), uvIn(uvTop, u, c));
      } else {
        up[i][j] = g.v(P(x, y + th, zc), uvIn(uvTop, u, c));
        lo[i][j] = g.v(P(x, y - th * 0.82, zc), uvIn(uvBot, u, c));
      }
    }
  }
  const idU = (i, j) => (j === 0 || j === chordN ? mid[i][j] : up[i][j]);
  const idL = (i, j) => (j === 0 || j === chordN ? mid[i][j] : lo[i][j]);
  for (let i = 0; i < spanN; i++) {
    for (let j = 0; j < chordN; j++) {
      // Upper: CCW from +Y. Lower: opposite.
      g.quad(idU(i, j), idU(i, j + 1), idU(i + 1, j + 1), idU(i + 1, j));
      g.quad(idL(i, j), idL(i + 1, j), idL(i + 1, j + 1), idL(i, j + 1));
    }
  }
  // Tip cap (span end, outward +X * side). Skip if the tip is a point.
  const i = spanN;
  for (let j = 0; j < chordN; j++) {
    if (side > 0) g.quad(idU(i, j), idL(i, j), idL(i, j + 1), idU(i, j + 1));
    else g.quad(idU(i, j), idU(i, j + 1), idL(i, j + 1), idL(i, j));
  }
  return g;
}

function addFuselage() {
  const g = new Geo();
  const specs = [
    // z, rx, ry, yc, chine, belly
    [-8.20, 0.02, 0.02, 0.00, 0.00, 0.00],
    [-7.70, 0.22, 0.20, 0.00, 0.05, 0.05],
    [-7.05, 0.42, 0.36, -0.02, 0.15, 0.10],
    [-6.30, 0.62, 0.48, -0.04, 0.35, 0.18],
    [-5.50, 0.82, 0.58, -0.06, 0.55, 0.28],
    [-4.60, 0.98, 0.64, -0.08, 0.75, 0.34],
    [-3.60, 1.12, 0.68, -0.08, 0.90, 0.38],
    [-2.50, 1.22, 0.70, -0.06, 0.95, 0.40],
    [-1.30, 1.28, 0.68, -0.04, 0.85, 0.36],
    [0.00, 1.24, 0.64, -0.02, 0.70, 0.30],
    [1.20, 1.10, 0.58, 0.00, 0.50, 0.22],
    [2.30, 0.92, 0.50, 0.04, 0.30, 0.16],
    [3.30, 0.70, 0.38, 0.10, 0.15, 0.10],
    [4.20, 0.48, 0.26, 0.18, 0.05, 0.05],
    [5.05, 0.28, 0.16, 0.22, 0.00, 0.00],
    [5.70, 0.10, 0.07, 0.16, 0.00, 0.00],
  ];
  const rings = specs.map((s) => ringXZ(s[0], s[1], s[2], s[3], SEG, s[4], s[5]));
  const ids = rings.map((ring, i) => ring.map((p, j) => {
    const su = j / SEG;
    const sv = i / (rings.length - 1);
    return g.v(P(p[0], p[1], p[2]), uvIn(ATLAS.fuse, su, sv));
  }));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      g.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]);
    }
  }
  return g;
}

function ringXZ(z, rx, ry, yc, n, chine, belly) {
  const pts = [];
  const pwr = 2 + chine * 2.4;
  const e = 2 / pwr;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(t);
    const sa = Math.sin(t);
    let x = Math.sign(ca) * Math.pow(Math.abs(ca), e) * rx;
    let y = Math.sign(sa) * Math.pow(Math.abs(sa), e) * ry;
    if (sa < 0) y *= 1 - belly;
    pts.push([x, yc + y, z]);
  }
  return pts;
}

function addLoftRings(rings, uvRect, suOf, svOf) {
  const g = new Geo();
  const n = rings[0].length - 1;
  const ids = rings.map((ring, i) => ring.map((p, j) => {
    return g.v(P(p[0], p[1], p[2]), uvIn(uvRect, suOf(i, j, rings.length, n), svOf(i, j, rings.length, n)));
  }));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      g.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]);
    }
  }
  return g;
}

function circleRing(z, cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, z]);
  }
  return pts;
}

function addNacelle(side) {
  const n = 14;
  const zs = [1.55, 2.4, 3.5, 4.6, 5.55, 6.35];
  const rs = [0.55, 0.62, 0.58, 0.50, 0.42, 0.36];
  const rings = zs.map((z, i) => circleRing(z, 0.62 * side, -0.18, rs[i], rs[i] * 0.92, n));
  // Mirror X for the left side by passing side into cx. circleRing already uses side.
  return addLoftRings(
    rings,
    ATLAS.metal,
    (_i, j) => j / n,
    (i) => i / (rings.length - 1),
  );
}

function addNozzle(side, paint, inner, glow) {
  const n = 16;
  const cx = 0.62 * side;
  const cy = -0.18;
  const outer = [
    circleRing(6.15, cx, cy, 0.40, 0.38, n),
    circleRing(6.85, cx, cy, 0.46, 0.44, n),
    circleRing(7.35, cx, cy, 0.40, 0.38, n),
  ];
  const shell = addLoftRings(outer, ATLAS.nozzle, (_i, j) => j / n, (i) => i / 2);
  appendInto(paint, shell);

  const duct = addLoftRings(
    [
      circleRing(6.55, cx, cy, 0.30, 0.28, n),
      circleRing(7.32, cx, cy, 0.34, 0.32, n),
    ],
    ATLAS.nozzle,
    (_i, j) => j / n,
    (i) => 0.15 + i * 0.7,
  );
  duct.orientOutward();
  duct.flip(); // inner wall faces the exhaust axis
  appendInto(inner, duct);

  // Seal + afterburner disc, normal +Z (toward the chase camera).
  const disc = new Geo();
  addDisc(disc, P(cx, cy, 6.50), 0.30 * S, n, true);
  appendInto(glow, disc);
}

function addDisc(geo, c, r, segs, normalPlusZ) {
  const center = geo.v(c, [0.5, 0.5]);
  const ring = [];
  for (let j = 0; j <= segs; j++) {
    const t = (j / segs) * Math.PI * 2;
    ring.push(geo.v([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r, c[2]], [0.5, 0.5]));
  }
  for (let j = 0; j < segs; j++) {
    if (normalPlusZ) geo.tri(center, ring[j], ring[j + 1]);
    else geo.tri(center, ring[j + 1], ring[j]);
  }
}

function appendInto(dst, src) {
  if (!src || src.indices.length === 0) return;
  const base = dst.verts.length;
  for (const v of src.verts) dst.verts.push({ p: v.p.slice(), uv: v.uv.slice(), n: v.n.slice() });
  for (const i of src.indices) dst.indices.push(i + base);
}

function addCanopy() {
  const g = new Geo();
  const n = 18;
  // Teardrop stations: z, halfWidth, archHeight, baseY
  const specs = [
    [-5.55, 0.06, 0.04, 0.48],
    [-5.15, 0.28, 0.22, 0.50],
    [-4.55, 0.46, 0.48, 0.52],
    [-3.85, 0.50, 0.62, 0.50],
    [-3.15, 0.42, 0.50, 0.46],
    [-2.55, 0.26, 0.28, 0.42],
    [-2.15, 0.08, 0.06, 0.40],
  ];
  const rings = specs.map(([z, hw, arch, baseY]) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      // i=0 left base, i=n/2 top, i=n right base
      const t = (i / n) * Math.PI; // 0 → PI, left to right over the top? 
      // We want left (-X) to right (+X) passing through +Y.
      const ang = Math.PI - t; // PI left (-X if cos), to 0 right
      const x = Math.cos(ang) * hw;
      const y = baseY + Math.sin(ang) * arch;
      pts.push([x, y, z]);
    }
    return pts;
  });
  const ids = rings.map((ring, i) => ring.map((p, j) => {
    return g.v(P(p[0], p[1], p[2]), uvIn(ATLAS.glass, j / n, i / (rings.length - 1)));
  }));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      g.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]);
    }
  }
  return g;
}

function addCockpit(interior, helmet) {
  // Floor, rear bulkhead, side walls, seat, helmet. Meters, then P().
  addBox(interior, [0, 0.38, -3.7], 0.85, 0.12, 2.5, [0.2, 0.2, 0.22]);
  addBox(interior, [0, 0.62, -2.35], 0.70, 0.55, 0.12, [0.15, 0.16, 0.17]);
  addBox(interior, [-0.38, 0.55, -3.9], 0.10, 0.28, 1.5, [0.18, 0.19, 0.2]);
  addBox(interior, [0.38, 0.55, -3.9], 0.10, 0.28, 1.5, [0.18, 0.19, 0.2]);
  addBox(interior, [0, 0.58, -3.15], 0.32, 0.55, 0.12, [0.22, 0.24, 0.23]);
  addSphere(helmet, P(0, 0.78, -3.55), 0.16 * S, 10, 8);
}

function addBox(geo, c, sx, sy, sz) {
  const [x, y, z] = c;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const p = [
    P(x - hx, y - hy, z - hz), P(x + hx, y - hy, z - hz), P(x + hx, y + hy, z - hz), P(x - hx, y + hy, z - hz),
    P(x - hx, y - hy, z + hz), P(x + hx, y - hy, z + hz), P(x + hx, y + hy, z + hz), P(x - hx, y + hy, z + hz),
  ];
  const face = (a, b, c0, d) => {
    const ia = geo.v(p[a], [0.2, 0.2]);
    const ib = geo.v(p[b], [0.8, 0.2]);
    const ic = geo.v(p[c0], [0.8, 0.8]);
    const id = geo.v(p[d], [0.2, 0.8]);
    geo.quad(ia, ib, ic, id);
  };
  face(3, 2, 6, 7); // +Y
  face(0, 4, 5, 1); // -Y
  face(1, 5, 6, 2); // +X
  face(4, 0, 3, 7); // -X
  face(4, 7, 6, 5); // +Z
  face(0, 1, 2, 3); // -Z
}

function addSphere(geo, c, r, seg, rings) {
  const top = geo.v([c[0], c[1] + r, c[2]], [0.5, 1]);
  const bot = geo.v([c[0], c[1] - r, c[2]], [0.5, 0]);
  const ids = [];
  for (let i = 1; i < rings; i++) {
    const phi = (i / rings) * Math.PI;
    ids[i] = [];
    for (let j = 0; j <= seg; j++) {
      const theta = (j / seg) * Math.PI * 2;
      ids[i][j] = geo.v([
        c[0] + Math.sin(phi) * Math.cos(theta) * r,
        c[1] + Math.cos(phi) * r,
        c[2] + Math.sin(phi) * Math.sin(theta) * r,
      ], [j / seg, 1 - i / rings]);
    }
  }
  for (let j = 0; j < seg; j++) geo.tri(top, ids[1][j + 1], ids[1][j]);
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      geo.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]);
    }
  }
  const last = rings - 1;
  for (let j = 0; j < seg; j++) geo.tri(bot, ids[last][j], ids[last][j + 1]);
}

function addIntake(side, shellParts, cavityParts) {
  const n = 12;
  const cx = 0.82 * side;
  const cy = -0.02;
  // Rounded-rect via superellipse, lofted along Z. Opening faces -Z.
  const mk = (z, rx, ry) => {
    const pts = [];
    const pwr = 3.2;
    const e = 2 / pwr;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const ca = Math.cos(t), sa = Math.sin(t);
      const x = cx + Math.sign(ca) * Math.pow(Math.abs(ca), e) * rx;
      const y = cy + Math.sign(sa) * Math.pow(Math.abs(sa), e) * ry;
      pts.push([x, y, z]);
    }
    return pts;
  };
  const shell = addLoftRings(
    [mk(-1.85, 0.34, 0.26), mk(-1.45, 0.28, 0.22), mk(-0.55, 0.24, 0.18), mk(0.15, 0.16, 0.12)],
    ATLAS.metal,
    (_i, j) => j / n,
    (i) => i / 3,
  );
  appendInto(shellParts, shell);

  const hole = addLoftRings(
    [mk(-1.55, 0.18, 0.13), mk(-0.7, 0.14, 0.10)],
    ATLAS.metal,
    (_i, j) => j / n,
    () => 0.05,
  );
  hole.orientOutward();
  hole.flip();
  appendInto(cavityParts, hole);

  const seal = new Geo();
  // Dark seal facing forward (-Z) so the duct doesn't see through the airframe.
  const c = P(cx, cy, -0.65);
  addDisc(seal, c, 0.15 * S, n, false);
  appendInto(cavityParts, seal);
}

function addLerx(side) {
  // Sharp leading-edge extension: thin wedge from beside the cockpit to the wing root.
  const g = new Geo();
  const n = 1;
  const specs = [
    { z: -4.2, x0: 0.42, x1: 0.62, y: 0.10, t: 0.035 },
    { z: -3.1, x0: 0.46, x1: 1.05, y: 0.08, t: 0.04 },
    { z: -2.0, x0: 0.50, x1: 1.45, y: 0.06, t: 0.045 },
    { z: -1.15, x0: 0.55, x1: 1.85, y: 0.05, t: 0.04 },
  ];
  const rings = specs.map((s) => {
    const x0 = s.x0 * side;
    const x1 = s.x1 * side;
    // Diamond: LE outboard point, TE inboard, top and bottom.
    // Use a 4-point section (plus seam) ordered around.
    const top = [ (x0 + x1) / 2, s.y + s.t, s.z + 0.05 ];
    const outer = [ x1, s.y, s.z - 0.55 ]; // forward outer = LE
    const bot = [ (x0 + x1) / 2, s.y - s.t * 0.65, s.z + 0.05 ];
    const inner = [ x0, s.y, s.z + 0.35 ];
    if (side > 0) return [outer, top, inner, bot, outer];
    return [outer, bot, inner, top, outer];
  });
  // The section order above isn't a consistent loft (points jump). Build as a ruled
  // surface between explicit top and bottom strips instead.
  void n;
  void rings;
  const top = [], bot = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const su = i / (specs.length - 1);
    top[i] = [
      g.v(P(s.x0 * side, s.y + s.t * 0.3, s.z + 0.25), uvIn(ATLAS.wingT, su * 0.35, 0.08)),
      g.v(P(s.x1 * side, s.y + s.t, s.z - 0.15), uvIn(ATLAS.wingT, su * 0.35, 0.22)),
    ];
    bot[i] = [
      g.v(P(s.x0 * side, s.y - s.t * 0.2, s.z + 0.25), uvIn(ATLAS.wingB, su * 0.35, 0.08)),
      g.v(P(s.x1 * side, s.y - s.t * 0.15, s.z - 0.15), uvIn(ATLAS.wingB, su * 0.35, 0.22)),
    ];
  }
  for (let i = 0; i < specs.length - 1; i++) {
    if (side > 0) {
      g.quad(top[i][0], top[i][1], top[i + 1][1], top[i + 1][0]);
      g.quad(bot[i][0], bot[i + 1][0], bot[i + 1][1], bot[i][1]);
    } else {
      g.quad(top[i][0], top[i + 1][0], top[i + 1][1], top[i][1]);
      g.quad(bot[i][0], bot[i][1], bot[i + 1][1], bot[i + 1][0]);
    }
    // LE strip (outer edge)
    if (side > 0) g.quad(top[i][1], bot[i][1], bot[i + 1][1], top[i + 1][1]);
    else g.quad(top[i][1], top[i + 1][1], bot[i + 1][1], bot[i][1]);
  }
  return g;
}

function addFin(side) {
  // Build a vertical airfoil in local space (span +Y, thickness ±X), then cant outward.
  const spanN = 7;
  const chordN = 10;
  const g = new Geo();
  const cant = side > 0 ? -0.34 : 0.34;
  const origin = [0.55 * side, 0.15, 0];
  const map = (x, y, z) => {
    // x is thickness, y is span
    const px = origin[0] + x;
    const py = origin[1] + y;
    const dx = px - origin[0];
    const dy = py - origin[1];
    const c = Math.cos(cant), s = Math.sin(cant);
    return P(origin[0] + dx * c - dy * s, origin[1] + dx * s + dy * c, z);
  };
  const up = [], lo = [], mid = [];
  for (let i = 0; i <= spanN; i++) {
    const s = i / spanN;
    const y = lerp(0.05, 2.55, s);
    const zLe = lerp(3.15, 4.05, s * s);
    const zTe = lerp(6.15, 5.35, s);
    const thick = lerp(0.09, 0.025, s);
    up[i] = []; lo[i] = []; mid[i] = [];
    for (let j = 0; j <= chordN; j++) {
      const c = j / chordN;
      const z = lerp(zLe, zTe, c);
      const th = airfoil(c) * thick;
      const uv = uvIn(ATLAS.tail, c, s);
      if (j === 0 || j === chordN) mid[i][j] = g.v(map(0, y, z), uv);
      else {
        up[i][j] = g.v(map(th, y, z), uv);
        lo[i][j] = g.v(map(-th, y, z), uv);
      }
    }
  }
  const idP = (i, j) => (j === 0 || j === chordN ? mid[i][j] : up[i][j]);
  const idN = (i, j) => (j === 0 || j === chordN ? mid[i][j] : lo[i][j]);
  for (let i = 0; i < spanN; i++) {
    for (let j = 0; j < chordN; j++) {
      // +X side and -X side. After cant, orientOutward fixes the pair.
      g.quad(idP(i, j), idP(i, j + 1), idP(i + 1, j + 1), idP(i + 1, j));
      g.quad(idN(i, j), idN(i + 1, j), idN(i + 1, j + 1), idN(i, j + 1));
    }
  }
  return g;
}

function addMissile(geo, cx, cy, zCenter) {
  const n = 8;
  const len = 3.15;
  const r = 0.16;
  const z0 = zCenter + len * 0.5; // tail (aft)
  const z1 = zCenter - len * 0.42; // body/nose junction
  const zNose = zCenter - len * 0.5;
  const rings = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = lerp(z0, z1, t);
    const rr = r * (i === 0 ? 0.72 : 1);
    rings.push(circleRing(z, cx, cy, rr, rr, n));
  }
  const body = addLoftRings(rings, ATLAS.missile, (_i, j) => j / n, (i) => i / steps);
  appendInto(geo, body);
  // Nose cone
  const cone = addLoftRings(
    [circleRing(z1, cx, cy, r, r, n), circleRing(zNose, cx, cy, 0.012, 0.012, n)],
    ATLAS.missile,
    (_i, j) => j / n,
    (i) => 0.75 + i * 0.25,
  );
  appendInto(geo, cone);
  // Four fins at the tail, thin so they don't z-fight.
  const finR = 0.38;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const nx = Math.cos(a), ny = Math.sin(a);
    const tx = -ny * 0.012, ty = nx * 0.012;
    const f = new Geo();
    const p = (z, rad, s) => P(cx + nx * rad + tx * s, cy + ny * rad + ty * s, z);
    const corners = (s) => [
      p(z0 - 0.15, r * 0.45, s),
      p(z0 + 0.08, r * 0.45, s),
      p(z0 + 0.08, finR, s),
      p(z0 - 0.62, finR * 0.9, s),
    ];
    const A = corners(1).map((pt) => f.v(pt, uvIn(ATLAS.missile, 0.2, 0.2)));
    const B = corners(-1).map((pt) => f.v(pt, uvIn(ATLAS.missile, 0.8, 0.2)));
    f.quad(A[0], A[1], A[2], A[3]);
    f.quad(B[0], B[3], B[2], B[1]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      f.quad(A[i], A[j], B[j], B[i]);
    }
    appendInto(geo, f);
  }
}

function addPylon(geo, x, y0, y1, z) {
  addBox(geo, [x, (y0 + y1) / 2, z], 0.08, Math.abs(y1 - y0), 0.55);
}

function addBlade(geo, c, sx, sy, sz) {
  addBox(geo, c, sx, sy, sz);
}

function boundsOf(geos) {
  const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const g of geos) {
    for (const v of g.verts) {
      for (let k = 0; k < 3; k++) {
        b.min[k] = Math.min(b.min[k], v.p[k]);
        b.max[k] = Math.max(b.max[k], v.p[k]);
      }
    }
  }
  return b;
}

function triCount(g) { return g.indices.length / 3; }

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

function hash2(ix, iy) {
  let n = (ix * 374761393 + iy * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y) {
  return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
}
function mix(a, b, t) { return a + (b - a) * t; }
function rgb(r, g, b) { return [r, g, b]; }
function mixc(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }

const COL = {
  top: rgb(132, 142, 152),
  side: rgb(176, 184, 192),
  belly: rgb(214, 220, 224),
  line: rgb(36, 42, 48),
  dirt: rgb(62, 56, 50),
  glass: rgb(14, 28, 36),
  glassHi: rgb(186, 214, 220),
  metal: rgb(54, 50, 46),
  heat: rgb(92, 62, 48),
  missile: rgb(206, 210, 214),
  band: rgb(64, 72, 80),
};

function inRect(u, v, r) {
  return u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;
}
function local(u, v, r) {
  return [(u - r.u0) / (r.u1 - r.u0), (v - r.v0) / (r.v1 - r.v0)];
}

function panelShade(su, sv, cols, rows, pxScaleU, pxScaleV) {
  const gu = su * cols;
  const gv = sv * rows;
  const lu = Math.round(gu);
  const lv = Math.round(gv);
  const du = Math.abs(gu - lu) * pxScaleU;
  const dv = Math.abs(gv - lv) * pxScaleV;
  let line = 0;
  if (hash2(lu, 17) > 0.22 && du < 1.35) line = Math.max(line, 1 - du / 1.35);
  if (hash2(3, lv) > 0.18 && dv < 1.35) line = Math.max(line, 1 - dv / 1.35);
  const cell = (hash2(Math.floor(gu), Math.floor(gv)) - 0.5) * 14;
  let rivet = 0;
  if (du < 2.4 && dv > 3 && hash2(lu * 13, Math.floor(gv * 3.5)) > 0.72) {
    const along = Math.abs((gv * 3.5) % 1 - 0.5);
    if (along > 0.35) rivet = 0.55;
  }
  return { line, cell, rivet };
}

function paintPixel(u, v) {
  const nse = (fbm(u * 28, v * 28) - 0.5) * 10;
  if (inRect(u, v, ATLAS.fuse)) {
    const [su, sv] = local(u, v, ATLAS.fuse);
    const top = Math.pow(Math.max(0, Math.cos((su - 0.5) * Math.PI * 2)), 0.55);
    const belly = Math.pow(Math.max(0, -Math.cos((su - 0.5) * Math.PI * 2)), 0.7);
    let c = mixc(COL.side, COL.top, top * 0.85);
    c = mixc(c, COL.belly, belly * 0.75);
    // Anti-glare panel ahead of the canopy
    if (sv < 0.34 && top > 0.45) c = mixc(c, rgb(42, 48, 56), (0.34 - sv) / 0.34 * top);
    // Exhaust soot toward the tail
    if (sv > 0.78) c = mixc(c, COL.dirt, (sv - 0.78) / 0.22 * 0.45);
    const pxU = (ATLAS.fuse.u1 - ATLAS.fuse.u0) * 1024;
    const pxV = (ATLAS.fuse.v1 - ATLAS.fuse.v0) * 1024;
    const sh = panelShade(su, sv, 10, 26, pxU / 10, pxV / 26);
    c = c.map((ch) => ch + sh.cell + nse);
    c = mixc(c, COL.line, sh.line * 0.72);
    if (sh.rivet) c = c.map((ch) => ch + 18 * sh.rivet);
    // Wing-root grime on the sides
    const sideBand = Math.exp(-Math.pow((su - 0.25) * 14, 2)) + Math.exp(-Math.pow((su - 0.75) * 14, 2));
    if (sv > 0.4 && sv < 0.62) c = mixc(c, rgb(64, 68, 72), sideBand * 0.35);
    return c;
  }
  if (inRect(u, v, ATLAS.wingT)) {
    const [su, sv] = local(u, v, ATLAS.wingT);
    let c = mixc(COL.top, rgb(96, 104, 112), 0.35);
    if (su < 0.16) c = mixc(c, rgb(58, 64, 70), (0.16 - su) / 0.16 * 0.55); // walkway
    if (sv < 0.06) c = mixc(c, rgb(150, 158, 166), (0.06 - sv) / 0.06 * 0.7); // LE metal
    if (sv > 0.74) c = mixc(c, rgb(108, 116, 124), 0.22); // aileron / flap
    const pxU = (ATLAS.wingT.u1 - ATLAS.wingT.u0) * 1024;
    const pxV = (ATLAS.wingT.v1 - ATLAS.wingT.v0) * 1024;
    const sh = panelShade(su, sv, 8, 10, pxU / 8, pxV / 10);
    c = c.map((ch) => ch + sh.cell * 0.8 + nse);
    c = mixc(c, COL.line, sh.line * 0.65);
    // Hinge line
    const hinge = Math.exp(-Math.pow((sv - 0.74) * pxV, 2) / 2.2);
    c = mixc(c, COL.line, hinge * 0.8);
    // Roundel — concentric, fictional, low-vis but readable
    const cx = (0.58 * (ATLAS.wingT.u1 - ATLAS.wingT.u0) + ATLAS.wingT.u0) * 1024;
    const cy = (0.46 * (ATLAS.wingT.v1 - ATLAS.wingT.v0) + ATLAS.wingT.v0) * 1024;
    const px = u * 1024, py = v * 1024;
    const d = Math.hypot(px - cx, py - cy);
    if (d < 58) {
      const ring = d > 38 && d < 56;
      const core = d < 20;
      if (ring) c = mixc(c, rgb(236, 240, 242), smooth(d, 56, 50) * smooth(d, 38, 44));
      else if (core) c = mixc(c, rgb(52, 72, 96), smooth(d, 20, 14));
      else if (d < 38) c = mixc(c, rgb(96, 108, 120), 0.45);
    }
    if (su > 0.92) c = mixc(c, rgb(70, 74, 78), (su - 0.92) / 0.08);
    return c;
  }
  if (inRect(u, v, ATLAS.wingB)) {
    const [su, sv] = local(u, v, ATLAS.wingB);
    let c = mixc(COL.belly, COL.side, 0.25);
    const pxU = (ATLAS.wingB.u1 - ATLAS.wingB.u0) * 1024;
    const pxV = (ATLAS.wingB.v1 - ATLAS.wingB.v0) * 1024;
    const sh = panelShade(su, sv, 6, 8, pxU / 6, pxV / 8);
    c = c.map((ch) => ch + sh.cell * 0.5 + nse * 0.6);
    c = mixc(c, COL.line, sh.line * 0.4);
    return c;
  }
  if (inRect(u, v, ATLAS.tail)) {
    const [su, sv] = local(u, v, ATLAS.tail);
    let c = mixc(COL.top, COL.side, 0.4);
    if (sv > 0.72) c = mixc(c, rgb(150, 156, 162), 0.35); // rudder cap
    const pxU = (ATLAS.tail.u1 - ATLAS.tail.u0) * 1024;
    const pxV = (ATLAS.tail.v1 - ATLAS.tail.v0) * 1024;
    const sh = panelShade(su, sv, 4, 8, pxU / 4, pxV / 8);
    c = c.map((ch) => ch + nse);
    c = mixc(c, COL.line, sh.line * 0.6);
    // Small low-vis chevron
    const bx = Math.abs(su - 0.5);
    const by = sv - 0.38;
    if (by > 0 && by < 0.22 && bx < by * 0.7 && bx > by * 0.7 - 0.06) {
      c = mixc(c, rgb(220, 224, 226), 0.8);
    }
    return c;
  }
  if (inRect(u, v, ATLAS.stab)) {
    const [su, sv] = local(u, v, ATLAS.stab);
    let c = rgb(100, 108, 116);
    const pxV = (ATLAS.stab.v1 - ATLAS.stab.v0) * 1024;
    const sh = panelShade(su, sv, 4, 5, 80, pxV / 5);
    c = mixc(c, COL.line, sh.line * 0.55);
    c = c.map((ch) => ch + nse * 0.5);
    return c;
  }
  if (inRect(u, v, ATLAS.nozzle)) {
    const [su, sv] = local(u, v, ATLAS.nozzle);
    let c = mixc(COL.metal, COL.heat, sv * 0.85);
    const ring = Math.abs(sv * 7 - Math.round(sv * 7));
    if (ring < 0.08) c = mixc(c, rgb(28, 26, 24), 0.65);
    c = c.map((ch, i) => ch + (fbm(su * 20, sv * 8) - 0.5) * (i === 0 ? 16 : 8));
    return c;
  }
  if (inRect(u, v, ATLAS.glass)) {
    const [su, sv] = local(u, v, ATLAS.glass);
    let c = mixc(COL.glass, rgb(28, 52, 62), sv * 0.5);
    // Specular streak
    const streak = Math.exp(-Math.pow((su - 0.32 - sv * 0.35) * 7, 2));
    c = mixc(c, COL.glassHi, streak * 0.75);
    // Frame hoops + bow
    const hoop = Math.min(
      Math.abs(sv - 0.18),
      Math.abs(sv - 0.48),
      Math.abs(sv - 0.78),
    );
    if (hoop < 0.015) c = mixc(c, rgb(8, 10, 12), 0.85);
    if (Math.abs(su - 0.5) < 0.012) c = mixc(c, rgb(8, 10, 12), 0.75);
    return c;
  }
  if (inRect(u, v, ATLAS.metal)) {
    const [su, sv] = local(u, v, ATLAS.metal);
    let c = mixc(rgb(88, 94, 100), COL.metal, 0.45);
    const sh = panelShade(su, sv, 5, 6, 40, 40);
    c = mixc(c, COL.line, sh.line * 0.45);
    c = c.map((ch) => ch + nse * 0.4);
    return c;
  }
  if (inRect(u, v, ATLAS.missile)) {
    const [su, sv] = local(u, v, ATLAS.missile);
    let c = COL.missile.slice();
    if (sv > 0.62 && sv < 0.78) c = COL.band.slice();
    if (sv > 0.88) c = rgb(186, 196, 150); // seeker band, subdued
    c = c.map((ch) => ch + (hash2(Math.floor(su * 30), Math.floor(sv * 40)) - 0.5) * 8);
    return c;
  }
  return rgb(70, 74, 78);
}

function smooth(d, e0, e1) {
  const t = clamp01((d - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function buildTexture(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size; // glTF v is up; PNG row 0 is top
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const c = paintPixel(u, v);
      const o = (y * size + x) * 4;
      rgba[o] = clamp8(c[0]);
      rgba[o + 1] = clamp8(c[1]);
      rgba[o + 2] = clamp8(c[2]);
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}
function clamp8(x) { return x < 0 ? 0 : x > 255 ? 255 : x | 0; }

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// GLB
// ---------------------------------------------------------------------------

function align4(n) { return (n + 3) & ~3; }

function geoArrays(geo, withUv) {
  const vcount = geo.verts.length;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Float32Array(vcount * 3);
  const uv = withUv ? new Float32Array(vcount * 2) : null;
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < vcount; i++) {
    const v = geo.verts[i];
    pos[i * 3] = v.p[0]; pos[i * 3 + 1] = v.p[1]; pos[i * 3 + 2] = v.p[2];
    nrm[i * 3] = v.n[0]; nrm[i * 3 + 1] = v.n[1]; nrm[i * 3 + 2] = v.n[2];
    if (uv) { uv[i * 2] = v.uv[0]; uv[i * 2 + 1] = v.uv[1]; }
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], v.p[k]);
      max[k] = Math.max(max[k], v.p[k]);
    }
  }
  const icount = geo.indices.length;
  const IndexArray = vcount > 65535 ? Uint32Array : Uint16Array;
  const idx = new IndexArray(icount);
  for (let i = 0; i < icount; i++) idx[i] = geo.indices[i];
  return { pos, nrm, uv, idx, min, max, indexType: vcount > 65535 ? 5125 : 5123 };
}

function writeGlb(primitives, jpeg) {
  // primitives: { geo, material, uv }
  const binParts = [];
  let cursor = 0;
  const bufferViews = [];
  const accessors = [];
  const primDefs = [];

  function pushView(bytes, target) {
    const pad = (4 - (cursor % 4)) % 4;
    if (pad) { binParts.push(Buffer.alloc(pad)); cursor += pad; }
    const byteOffset = cursor;
    binParts.push(bytes);
    cursor += bytes.length;
    const view = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target) view.target = target;
    bufferViews.push(view);
    return bufferViews.length - 1;
  }
  function pushAccessor(view, type, componentType, count, extra) {
    const acc = { bufferView: view, componentType, count, type, ...extra };
    accessors.push(acc);
    return accessors.length - 1;
  }

  for (const prim of primitives) {
    if (prim.geo.indices.length === 0) continue;
    const a = geoArrays(prim.geo, prim.uv);
    const posView = pushView(Buffer.from(a.pos.buffer), 34962);
    const nrmView = pushView(Buffer.from(a.nrm.buffer), 34962);
    let uvId = null;
    if (a.uv) {
      const uvView = pushView(Buffer.from(a.uv.buffer), 34962);
      uvId = pushAccessor(uvView, 'VEC2', 5126, a.uv.length / 2, {});
    }
    const idxView = pushView(Buffer.from(a.idx.buffer), 34963);
    const posId = pushAccessor(posView, 'VEC3', 5126, a.pos.length / 3, { min: a.min, max: a.max });
    const nrmId = pushAccessor(nrmView, 'VEC3', 5126, a.nrm.length / 3, {});
    const idxId = pushAccessor(idxView, 'SCALAR', a.indexType, a.idx.length, {});
    const attributes = { POSITION: posId, NORMAL: nrmId };
    if (uvId != null) attributes.TEXCOORD_0 = uvId;
    primDefs.push({
      attributes,
      indices: idxId,
      material: prim.material,
      mode: 4,
      extras: { part: prim.part },
    });
  }

  const imageView = pushView(jpeg, null);
  const bin = Buffer.concat(binParts);

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'midway-fighter-lowpoly',
      extras: {
        name: 'MF-24',
        note: 'Original low-poly modern fighter. Nose -Z, up +Y. Units are game units.',
      },
    },
    scene: 0,
    scenes: [{ nodes: [0], name: 'fighter' }],
    nodes: [{ name: 'fighter', mesh: 0 }],
    meshes: [{ name: 'fighter', primitives: primDefs }],
    materials: [
      {
        name: 'paint',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0.1,
          roughnessFactor: 0.68,
        },
      },
      {
        name: 'nozzle',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0.72,
          roughnessFactor: 0.32,
        },
      },
      {
        name: 'glass',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          baseColorFactor: [0.75, 0.88, 0.95, 0.92],
          metallicFactor: 0.55,
          roughnessFactor: 0.08,
        },
        alphaMode: 'BLEND',
        doubleSided: true,
      },
      {
        name: 'interior',
        pbrMetallicRoughness: {
          baseColorFactor: [0.07, 0.08, 0.085, 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.85,
        },
      },
      {
        name: 'helmet',
        pbrMetallicRoughness: {
          baseColorFactor: [0.18, 0.22, 0.20, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.55,
        },
      },
      {
        name: 'glow',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0.28, 0.05, 1],
          metallicFactor: 0,
          roughnessFactor: 0.4,
        },
        emissiveFactor: [1, 0.32, 0.05],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } },
      },
      {
        name: 'light-red',
        pbrMetallicRoughness: { baseColorFactor: [1, 0.08, 0.05, 1], metallicFactor: 0, roughnessFactor: 0.4 },
        emissiveFactor: [1, 0.05, 0.03],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } },
      },
      {
        name: 'light-green',
        pbrMetallicRoughness: { baseColorFactor: [0.15, 1, 0.25, 1], metallicFactor: 0, roughnessFactor: 0.4 },
        emissiveFactor: [0.1, 1, 0.2],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } },
      },
      {
        name: 'light-white',
        pbrMetallicRoughness: { baseColorFactor: [1, 0.95, 0.85, 1], metallicFactor: 0, roughnessFactor: 0.35 },
        emissiveFactor: [1, 0.9, 0.7],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2.5 } },
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ mimeType: 'image/jpeg', bufferView: imageView }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
    extensionsUsed: ['KHR_materials_emissive_strength'],
  };

  let json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  const binPadN = (4 - (bin.length % 4)) % 4;
  const binPad = binPadN ? Buffer.concat([bin, Buffer.alloc(binPadN)]) : bin;

  const total = 12 + 8 + json.length + 8 + binPad.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPad.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, json, bh, binPad]);
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

function build() {
  console.log('building MF-24…');
  const paint = new Geo();
  const nozzle = new Geo();
  const glass = new Geo();
  const interior = new Geo();
  const helmet = new Geo();
  const glow = new Geo();
  const red = new Geo();
  const green = new Geo();
  const white = new Geo();

  const fuse = finalize(addFuselage(), 'fuselage');
  appendInto(paint, fuse);

  const wingR = finalize(addAirfoil({
    spanN: 12,
    chordN: 16,
    station: wingStation,
    uvTop: ATLAS.wingT,
    uvBot: ATLAS.wingB,
    side: 1,
    deflect: -0.035,
    hingeC: 0.7,
  }), 'wingR');
  const wingL = finalize(addAirfoil({
    spanN: 12,
    chordN: 16,
    station: wingStation,
    uvTop: ATLAS.wingT,
    uvBot: ATLAS.wingB,
    side: -1,
    deflect: -0.035,
    hingeC: 0.7,
  }), 'wingL');
  appendInto(paint, wingR);
  appendInto(paint, wingL);

  const stabStation = (s) => ({
    x: lerp(0.35, 2.55, s),
    y: lerp(-0.05, -0.28, s),
    zLe: lerp(4.55, 5.15, s),
    zTe: lerp(6.85, 6.45, s),
    thick: lerp(0.07, 0.025, s),
  });
  appendInto(paint, finalize(addAirfoil({
    spanN: 6, chordN: 8, station: stabStation, uvTop: ATLAS.stab, uvBot: ATLAS.stab, side: 1,
  }), 'stabR'));
  appendInto(paint, finalize(addAirfoil({
    spanN: 6, chordN: 8, station: stabStation, uvTop: ATLAS.stab, uvBot: ATLAS.stab, side: -1,
  }), 'stabL'));

  appendInto(paint, finalize(addLerx(1), 'lerxR'));
  appendInto(paint, finalize(addLerx(-1), 'lerxL'));
  appendInto(paint, finalize(addFin(1), 'finR'));
  appendInto(paint, finalize(addFin(-1), 'finL'));

  const nacR = finalize(addNacelle(1), 'nacelleR');
  const nacL = finalize(addNacelle(-1), 'nacelleL');
  appendInto(nozzle, nacR);
  appendInto(nozzle, nacL);

  const nozzlePaint = new Geo();
  const nozzleInner = new Geo();
  addNozzle(1, nozzlePaint, nozzleInner, glow);
  addNozzle(-1, nozzlePaint, nozzleInner, glow);
  appendInto(nozzle, finalize(nozzlePaint, 'nozzle'));
  // Ducts were flipped inward in addNozzle / addIntake. Don't orient them again.
  nozzleInner.computeNormals(48);
  console.log(`  ${'duct'.padEnd(10)} ${String(nozzleInner.indices.length / 3).padStart(5)} tris`);

  appendInto(glass, finalize(addCanopy(), 'canopy'));
  addCockpit(interior, helmet);
  interior.orientOutward();
  helmet.orientOutward();

  const intakeShell = new Geo();
  const intakeHole = new Geo();
  addIntake(1, intakeShell, intakeHole);
  addIntake(-1, intakeShell, intakeHole);
  appendInto(nozzle, finalize(intakeShell, 'intake'));
  intakeHole.computeNormals(48);
  console.log(`  ${'intakeIn'.padEnd(10)} ${String(intakeHole.indices.length / 3).padStart(5)} tris`);
  appendInto(interior, nozzleInner);
  appendInto(interior, intakeHole);

  const missiles = new Geo();
  // Wingtip rails — sit just outboard and slightly below the tip.
  const tip = wingStation(1);
  const tipZ = (tip.zLe + tip.zTe) / 2 - 0.15;
  addMissile(missiles, tip.x - 0.05, tip.y - 0.08, tipZ);
  addMissile(missiles, -tip.x + 0.05, tip.y - 0.08, tipZ);
  const mid = wingStation(0.46);
  const midZ = (mid.zLe + mid.zTe) / 2 + 0.15;
  addMissile(missiles, mid.x, mid.y - 0.38, midZ);
  addMissile(missiles, -mid.x, mid.y - 0.38, midZ);
  addPylon(missiles, mid.x, mid.y - 0.08, mid.y - 0.28, midZ + 0.25);
  addPylon(missiles, -mid.x, mid.y - 0.08, mid.y - 0.28, midZ + 0.25);
  appendInto(paint, finalize(missiles, 'missiles'));

  // Pitot only — spine antennas read as boxes at this camera distance.
  addBlade(paint, [0, 0.08, -8.55], 0.02, 0.02, 0.42);
  finalize(paint, 'paintAll');

  // Lights are tiny boxes; give them outward normals via finalize.
  addBox(red, [-tip.x, tip.y, tip.zTe - 0.05], 0.08, 0.06, 0.1);
  addBox(green, [tip.x, tip.y, tip.zTe - 0.05], 0.08, 0.06, 0.1);
  addBox(white, [0, 0.42, 5.4], 0.06, 0.06, 0.06);
  addBox(white, [0, 0.15, -7.9], 0.05, 0.05, 0.05);
  finalize(red, 'red');
  finalize(green, 'green');
  finalize(white, 'white');
  // Parts were oriented before append; recompute normals on the merged buckets.
  // Interior stays mixed (cockpit outward, ducts inward) so it is not re-oriented.
  paint.computeNormals(40);
  nozzle.orientOutward();
  nozzle.computeNormals(40);
  glass.orientOutward();
  glass.computeNormals(58);
  interior.computeNormals(48);
  helmet.orientOutward();
  helmet.computeNormals(50);
  glow.computeNormals(80);

  const groups = [paint, nozzle, glass, interior, helmet, glow, red, green, white];
  const b = boundsOf(groups);
  const tris = groups.reduce((s, g) => s + triCount(g), 0);
  console.log(`triangles ${tris}`);
  console.log(`bbox min ${b.min.map((n) => n.toFixed(2)).join(', ')}`);
  console.log(`bbox max ${b.max.map((n) => n.toFixed(2)).join(', ')}`);
  console.log(`length ${(b.max[2] - b.min[2]).toFixed(2)}  span ${(b.max[0] - b.min[0]).toFixed(2)}  height ${(b.max[1] - b.min[1]).toFixed(2)}`);
  console.log(`nose offset ${(-b.min[2]).toFixed(2)} (bullet spawn ahead of this)`);
  if (tris > 10000) throw new Error(`over triangle budget: ${tris}`);
  if (tris < 800) throw new Error(`mesh looks empty: ${tris}`);

  const size = 1024;
  console.log('painting 1024 atlas…');
  const rgba = buildTexture(size);
  const png = encodePNG(size, rgba);
  const tmpPng = path.join('/tmp', 'fighter-albedo.png');
  const tmpJpg = path.join('/tmp', 'fighter-albedo.jpg');
  fs.writeFileSync(tmpPng, png);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '76', tmpPng, '--out', tmpJpg]);
  const jpeg = fs.readFileSync(tmpJpg);
  console.log(`jpeg ${(jpeg.length / 1024).toFixed(0)} KB`);

  const glb = writeGlb([
    { geo: paint, material: 0, uv: true, part: 'paint' },
    { geo: nozzle, material: 1, uv: true, part: 'paint' },
    { geo: glass, material: 2, uv: true, part: 'glass' },
    { geo: interior, material: 3, uv: false, part: 'interior' },
    { geo: helmet, material: 4, uv: false, part: 'interior' },
    { geo: glow, material: 5, uv: false, part: 'glow' },
    { geo: red, material: 6, uv: false, part: 'light' },
    { geo: green, material: 7, uv: false, part: 'light' },
    { geo: white, material: 8, uv: false, part: 'light' },
  ], jpeg);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, glb);
  console.log(`wrote ${OUT}  ${(glb.length / 1024).toFixed(0)} KB`);
}

build();
