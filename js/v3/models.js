import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const texLoader = new THREE.TextureLoader();
const cache = new Map();
/** Original MF-24: assets/models/fighter.glb, nose -Z, one JPEG, ~5k tris. */
let fighterTemplate = null;
/** Innerscene generic carrier, CC0. Bow +X, keel y=0, ~330 m, 36k tris. */
let carrierTemplate = null;
const CARRIER_LENGTH_M = 330;
const CARRIER_CENTER_M = 161;
const CARRIER_DRAFT_M = 12;
const WORLD_PER_METER = 0.29;

export function preloadFighter(url = 'assets/models/fighter.glb', renderer) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (renderer) {
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/');
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      fighterTemplate = gltf.scene;
      resolve(gltf);
    }, undefined, reject);
  });
}

export function hasFighterModel() {
  return !!fighterTemplate;
}

export function preloadCarrier(url = 'assets/models/carrier.glb') {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      carrierTemplate = gltf.scene;
      resolve(gltf);
    }, undefined, reject);
  });
}

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
  const apply = (tex) => {
    if (!tex) return;
    tex.anisotropy = Math.min(8, max);
    tex.needsUpdate = true;
  };
  for (const tex of cache.values()) apply(tex);
  fighterTemplate?.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = [].concat(obj.material || []);
    mats.forEach((m) => apply(m.map));
  });
}

export function createFighter(_color = 0x4aa3ff, enemy = false) {
  if (fighterTemplate) return instantiateFighter(enemy);
  return buildModernJet(enemy);
}

function instantiateFighter(enemy) {
  const model = fighterTemplate.clone(true);
  model.scale.setScalar(0.8);
  model.traverse((obj) => {
    if (obj.name && obj.name.includes('gear')) obj.visible = false;
    if (!obj.isMesh || !obj.material) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = list.map((mat) => {
      const copy = mat.clone();
      if (enemy && copy.color) copy.color.offsetHSL(0, 0.04, -0.16);
      return copy;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  });

  const root = new THREE.Group();
  root.add(model);
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
  if (!carrierTemplate) return createShip('carrier');
  const root = new THREE.Group();
  const model = carrierTemplate.clone(true);
  const s = WORLD_PER_METER;
  model.scale.setScalar(s);
  model.rotation.y = Math.PI / 2;
  model.position.set(0, -CARRIER_DRAFT_M * s, CARRIER_CENTER_M * s);
  root.add(model);
  root.userData.kind = 'carrier';
  root.userData.length = CARRIER_LENGTH_M * s;
  return root;
}

function buildTexturedShip(tex, kind) {
  const group = new THREE.Group();
  const imgW = tex.image?.width || 1024;
  const imgH = tex.image?.height || 512;
  const aspect = imgW / Math.max(imgH, 1);
  const length = kind === 'carrier' ? 70 : 54;
  const beam = length / aspect;

  const deckMat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.2,
    metalness: 0.22,
    roughness: 0.62,
    side: THREE.DoubleSide,
    color: 0xffffff,
  });
  const hullMat = new THREE.MeshStandardMaterial({
    color: kind === 'carrier' ? 0x6d767e : 0x5c656e,
    metalness: 0.42,
    roughness: 0.48,
  });

  // Bow of the reference image is on the left. Lay the deck on the water, bow toward -Z.
  const deckGeo = new THREE.PlaneGeometry(length, beam);
  deckGeo.rotateX(-Math.PI / 2);
  // Carrier art: bow on the right. Destroyer art: bow on the left.
  deckGeo.rotateY(kind === 'carrier' ? Math.PI / 2 : -Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.y = 1.55;
  deck.name = 'shipCard';
  group.add(deck);

  const hullH = kind === 'carrier' ? 2.4 : 1.6;
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.62, hullH, length * 0.7),
    hullMat
  );
  hull.position.y = 1.48 - hullH / 2;
  group.add(hull);

  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.66, 0.45, length * 0.74),
    new THREE.MeshStandardMaterial({ color: 0x8e2428, metalness: 0.15, roughness: 0.62 })
  );
  boot.position.y = 0.28;
  group.add(boot);

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

export function createOcean(size = 24000) {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const map = new THREE.TextureLoader().load('assets/textures/yellow-river.jpg');
  map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const normalMap = new THREE.TextureLoader().load('assets/textures/waternormals.jpg');
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uMap: { value: map },
      uNormal: { value: normalMap },
      uScale: { value: 0.0032 },
      uOffset: { value: new THREE.Vector2(0.62, 0.48) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uCam;
      uniform sampler2D uMap;
      uniform sampler2D uNormal;
      uniform float uScale;
      uniform vec2 uOffset;
      varying vec3 vWorld;
      void main() {
        vec2 uv = vWorld.xz * uScale + uOffset;
        vec3 albedo = texture2D(uMap, uv).rgb;
        float wet = smoothstep(0.03, 0.16, albedo.b - max(albedo.r, albedo.g * 0.9));
        wet *= smoothstep(0.45, 0.14, albedo.r);
        vec3 n = texture2D(uNormal, vWorld.xz * 0.09 + vec2(uTime * 0.035, uTime * 0.012)).xyz * 2.0 - 1.0;
        vec3 normal = normalize(vec3(n.x * wet, 1.0, n.y * wet));
        vec3 viewDir = normalize(uCam - vWorld);
        vec3 sunDir = normalize(vec3(0.32, 0.84, 0.24));
        float spec = pow(clamp(dot(normal, normalize(sunDir + viewDir)), 0.0, 1.0), 70.0) * wet;
        vec3 color = albedo + vec3(0.7, 0.88, 1.0) * spec * 0.45;
        float haze = smoothstep(0.05, 0.0, clamp(viewDir.y, 0.0, 1.0));
        gl_FragColor = vec4(mix(color, vec3(0.62, 0.76, 0.88), haze), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -18;
  return mesh;
}

export function createSky() {
  const tex = new THREE.TextureLoader().load('assets/textures/sky.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1;
  tex.offset.x = 1;
  const geo = new THREE.SphereGeometry(480, 64, 40);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function createClouds() {
  return new THREE.Group();
}

function discMesh(radius, material, y) {
  const geo = new THREE.CircleGeometry(radius, 64);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y;
  return mesh;
}

const sharedMaps = {};

function sharedMap(url, colorSpace) {
  if (!sharedMaps[url]) {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = colorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    sharedMaps[url] = tex;
  }
  return sharedMaps[url];
}

function repeated(url, colorSpace, repeat) {
  const tex = sharedMap(url, colorSpace).clone();
  tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  return tex;
}

/** One island at a world position. Textures are shared; only this patch is built. */
export function createIsland(x, z, radius) {
  const group = new THREE.Group();
  const repeat = Math.max(2.2, radius / 14);
  const sand = discMesh(radius * 1.22, new THREE.MeshStandardMaterial({
    map: repeated('assets/textures/aerial_beach.jpg', THREE.SRGBColorSpace, repeat * 0.85),
    roughness: 0.96,
    metalness: 0,
  }), -17.55);
  const land = discMesh(radius, new THREE.MeshStandardMaterial({
    map: repeated('assets/textures/aerial_grass.jpg', THREE.SRGBColorSpace, repeat),
    normalMap: repeated('assets/textures/aerial_grass_nor.jpg', THREE.NoColorSpace, repeat),
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.88,
    metalness: 0.02,
  }), -17.28);
  sand.position.set(x, sand.position.y, z);
  land.position.set(x, land.position.y, z);
  group.add(sand);
  group.add(land);
  return group;
}
