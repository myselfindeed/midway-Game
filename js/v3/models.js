import * as THREE from 'three';

const texLoader = new THREE.TextureLoader();
const cache = new Map();

/** Preload reference textures. Call before creating units. */
export function preloadTextures(urls = {
  fighter: 'assets/fighter.png',
  destroyer: 'assets/destroyer.png',
  carrier: 'assets/carrier.png',
}) {
  const entries = Object.entries(urls);
  return Promise.all(
    entries.map(
      ([key, url]) =>
        new Promise((resolve, reject) => {
          texLoader.load(
            url,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = 8;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.generateMipmaps = true;
              cache.set(key, tex);
              resolve(tex);
            },
            undefined,
            reject
          );
        })
    )
  );
}

export function getTexture(key) {
  return cache.get(key) || null;
}

/** Call after WebGLRenderer exists to sharpen reference textures. */
export function applyRendererAnisotropy(renderer) {
  const max = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  for (const tex of cache.values()) {
    tex.anisotropy = Math.min(8, max);
    tex.needsUpdate = true;
  }
}

/**
 * Original low-poly modern fighter (gray/white, blue nozzle).
 * Nose is local -Z. Not a copy of the reference game's model.
 */
export function createFighter(_color = 0x4aa3ff, enemy = false) {
  const root = buildModernJet(enemy);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.7;
  shadow.renderOrder = -1;
  root.add(shadow);
  return root;
}

function jetMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.62,
    roughness: 0.34,
    ...extra,
  });
}

function buildModernJet(enemy) {
  const g = new THREE.Group();
  const upper = enemy ? 0x8e949c : 0xd7dbe0;
  const lower = enemy ? 0x6d737b : 0xb7bdc4;
  const dark = enemy ? 0x2a2e34 : 0x3c434c;
  const mark = enemy ? 0xd24a4a : 0xf2f4f6;

  const body = jetMat(upper);
  const belly = jetMat(lower);
  const metal = jetMat(dark, { metalness: 0.75, roughness: 0.28 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x163044,
    metalness: 0.85,
    roughness: 0.12,
  });

  const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 3.15), body);
  fuse.position.set(0, 0, -0.15);
  g.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.15, 8), body);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.02, -1.95);
  g.add(nose);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 2.2), metal);
  spine.position.set(0, 0.28, -0.15);
  g.add(spine);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.85, 0.7, 1.35);
  canopy.position.set(0, 0.22, -0.85);
  g.add(canopy);

  const wingGeo = new THREE.BoxGeometry(1.55, 0.06, 0.72);
  const wingL = new THREE.Mesh(wingGeo, belly);
  wingL.position.set(-1.05, -0.02, 0.05);
  wingL.rotation.z = 0.06;
  wingL.rotation.y = 0.18;
  g.add(wingL);
  const wingR = wingL.clone();
  wingR.position.x = 1.05;
  wingR.rotation.z = -0.06;
  wingR.rotation.y = -0.18;
  g.add(wingR);

  const tipMat = jetMat(mark, { metalness: 0.2, roughness: 0.45 });
  const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.22), tipMat);
  tipL.position.set(-1.72, -0.04, 0.18);
  g.add(tipL);
  const tipR = tipL.clone();
  tipR.position.x = 1.72;
  g.add(tipR);

  const stabGeo = new THREE.BoxGeometry(0.55, 0.045, 0.32);
  const stabL = new THREE.Mesh(stabGeo, body);
  stabL.position.set(-0.48, 0.05, 1.22);
  g.add(stabL);
  const stabR = stabL.clone();
  stabR.position.x = 0.48;
  g.add(stabR);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.55), metal);
  fin.position.set(0, 0.62, 1.15);
  g.add(fin);

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.28, 12), metal);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0, 1.5);
  g.add(nozzle);

  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.85, 10),
    new THREE.MeshBasicMaterial({ color: enemy ? 0xff6633 : 0x7ef6ff, transparent: true, opacity: 0.95 })
  );
  exhaust.rotation.x = -Math.PI / 2;
  exhaust.position.set(0, 0, 1.95);
  exhaust.name = 'exhaust';
  g.add(exhaust);

  const glow = new THREE.PointLight(enemy ? 0xff5522 : 0x66eeff, 1.4, 8, 2);
  glow.position.set(0, 0, 1.7);
  g.add(glow);

  return g;
}

function buildFallbackFighter(color, enemy) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.25,
    roughness: 0.55,
    emissive: color,
    emissiveIntensity: 0.18,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: enemy ? 0xff5a5a : 0xd8e7ff,
    metalness: 0.2,
    roughness: 0.55,
    emissive: enemy ? 0xff5a5a : 0x88cfff,
    emissiveIntensity: 0.12,
  });

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 2.2), bodyMat);
  fuselage.position.z = 0.1;
  root.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 6), accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -1.35;
  root.add(nose);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.7), bodyMat);
  wing.position.set(0, -0.05, 0.15);
  root.add(wing);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.35), bodyMat);
  tail.position.set(0, 0.05, 1.05);
  root.add(tail);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), accentMat);
  fin.position.set(0, 0.35, 1.0);
  root.add(fin);

  return root;
}

/**
 * Top-down ship deck on the ocean (质感来自 destroyer/carrier.png).
 * @param {'destroyer'|'carrier'} kind
 */
export function createShip(kind = 'destroyer') {
  const root = new THREE.Group();
  const tex = getTexture(kind);

  if (tex) {
    root.add(buildTexturedShip(tex, kind));
  } else {
    root.add(buildFallbackShip(kind));
  }

  root.userData.kind = kind;
  return root;
}

export function createDestroyer() {
  return createShip('destroyer');
}

export function createCarrier() {
  return createShip('carrier');
}

function buildTexturedShip(tex, kind) {
  const group = new THREE.Group();
  const imgW = tex.image?.width || 1024;
  const imgH = tex.image?.height || 512;
  const aspect = imgW / Math.max(imgH, 1);

  // Card size — large enough to read from chase-cam altitude
  const width = kind === 'carrier' ? 48 : 26;
  const height = width / aspect;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.28,
    metalness: 0.38,
    roughness: 0.68,
    side: THREE.DoubleSide,
    color: 0xffffff,
    emissive: 0x0a1218,
    emissiveIntensity: 0.06,
    depthWrite: true,
  });

  // Face local +Z; Game will yaw the root toward the camera (cylindrical billboard)
  // so top-down ship art stays readable at shallow aerial angles.
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  card.position.y = height * 0.42;
  card.name = 'shipCard';
  group.add(card);

  // Water footprint shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.95, Math.min(height, width) * 0.35),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = -1;
  group.add(shadow);

  return group;
}

function buildFallbackShip(kind) {
  const group = new THREE.Group();
  const length = kind === 'carrier' ? 56 : 30;
  const beam = kind === 'carrier' ? 10 : 5;
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(beam, 1.2, length),
    new THREE.MeshStandardMaterial({
      color: kind === 'carrier' ? 0x6a7a88 : 0x5a6570,
      metalness: 0.35,
      roughness: 0.7,
    })
  );
  hull.position.y = 0.4;
  group.add(hull);
  if (kind === 'carrier') {
    const island = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 3.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.3, roughness: 0.65 })
    );
    island.position.set(beam * 0.28, 2.2, 4);
    group.add(island);
  } else {
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.3, roughness: 0.65 })
    );
    bridge.position.set(0, 1.8, -2);
    group.add(bridge);
  }
  return group;
}

export function createOcean(size = 800) {
  const geo = new THREE.PlaneGeometry(size, size, 64, 64);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a6f9a,
    metalness: 0.2,
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -18;
  return mesh;
}

export function createSky() {
  const geo = new THREE.SphereGeometry(480, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.55, 0.0, 1.0);
        vec3 zenith = vec3(0.28, 0.55, 0.90);
        vec3 mid = vec3(0.55, 0.76, 0.95);
        vec3 horizon = vec3(0.82, 0.90, 0.96);
        vec3 col = mix(horizon, mid, smoothstep(0.08, 0.42, h));
        col = mix(col, zenith, smoothstep(0.42, 1.0, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 18; i++) {
    const x = 40 + Math.random() * 176;
    const y = 50 + Math.random() * 150;
    const r = 28 + Math.random() * 36;
    const grd = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createClouds() {
  const group = new THREE.Group();
  const tex = cloudTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 10; i++) {
    const w = 40 + Math.random() * 50;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.55), mat);
    mesh.position.set((Math.random() - 0.5) * 280, 28 + Math.random() * 40, (Math.random() - 0.5) * 280);
    mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.2;
    mesh.rotation.z = Math.random() * Math.PI;
    group.add(mesh);
  }
  return group;
}
