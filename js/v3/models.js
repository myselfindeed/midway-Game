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
    ktx2.setTranscoderPath('vendor/three/examples/jsm/libs/basis/');
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      fighterTemplate = normalizeFighterModel(gltf.scene);
      resolve(gltf);
    }, undefined, reject);
  });
}

/**
 * 把任意来源的战机素材规整成统一规格，调用方不必关心资产差异：
 *   · 以包围盒中心为原点（否则相机会对着机腹、碰撞点在机身外）
 *   · 按机身长轴缩放到固定机长（换 F-16 级资产不用改任何参数）
 *   · 机头统一朝 -Z（本作所有飞行器与相机都按 -Z 为前）
 */
function normalizeFighterModel(scene, targetLength = 5.3) {
  scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const longAxis = Math.max(size.x, size.z);
  const scale = targetLength / Math.max(0.001, longAxis);

  scene.position.set(-center.x, -center.y, -center.z);

  const pivot = new THREE.Group();
  pivot.add(scene);
  pivot.scale.setScalar(scale);
  // 资产机头朝向不统一：隐身机朝 +Z，F-16 朝 +X。
  // 用包围盒长轴判断（机长 > 翼展），长轴是 X 的先补 90° 再统一到 -Z，
  // 否则飞机会一直横着飞 90°，而追尾视角下这点很容易被误读成"机头偏了一点"。
  const noseAlongX = size.x > size.z;
  pivot.rotation.y = noseAlongX ? Math.PI / 2 : Math.PI;
  pivot.userData.noseAlongX = noseAlongX;
  pivot.userData.fighterLength = targetLength;
  pivot.userData.sourceSize = { x: size.x, y: size.y, z: size.z };
  return pivot;
}

/**
 * 尾焰材质：带马赫环（shock diamonds）的加色锥体。
 *
 * 真实加力燃烧的火焰里有一串横向亮环——那是喷流里的激波结构，间距基本固定、
 * 亮度沿轴向递减。用 shader 在几何的 z 轴上做周期调制就行，不用额外的环状网格。
 *
 * 三个关键点：
 *   1. vT 用 `position.z / uLength`，是**几何局部坐标**，所以 group.scale.z 改长度时
 *      环的分布不会跟着变形（这也是不用 uv 的原因——自定义几何没 uv）。
 *   2. 边缘用菲涅尔软化（正对相机最亮、侧掠渐隐），否则锥体边界会是一条硬直线。
 *   3. 颜色必须传 Vector3。ShaderMaterial 的 vec3 uniform 不认 THREE.Color，
 *      传 Color 会得到 undefined 行为。
 */
const FLAME_TIME = { value: 0 };

export function updateFlameTime(t) {
  FLAME_TIME.value = t;
}

function flameMaterial(hot, warm, intensity, length, ringFreq, ringAmp) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: FLAME_TIME,
      uHot: { value: new THREE.Vector3(hot.r, hot.g, hot.b) },
      uWarm: { value: new THREE.Vector3(warm.r, warm.g, warm.b) },
      uIntensity: { value: intensity },
      uLength: { value: length },
      uRingFreq: { value: ringFreq },
      uRingAmp: { value: ringAmp },
    },
    vertexShader: /* glsl */ `
      uniform float uLength;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = clamp(position.z / uLength, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uHot;
      uniform vec3 uWarm;
      uniform float uIntensity;
      uniform float uRingFreq;
      uniform float uRingAmp;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;

      void main() {
        // 轴向衰减：越靠后越淡
        float fade = pow(1.0 - vT, 1.35);

        // 马赫环：窄亮环 + 缓慢向后流动。pow(...,6.0) 把正弦削成尖峰，
        // 环外压到 0.12，环上给满——对比不够就完全看不出"环"，只是一条均匀的光带。
        float band = 0.5 + 0.5 * sin(vT * uRingFreq - uTime * 5.0);
        float rings = mix(1.0, 0.12 + 0.88 * pow(band, 6.0), uRingAmp);

        // 边缘软化：正对相机处最亮，侧掠处渐隐
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float soft = 0.30 + 0.70 * pow(facing, 0.9);

        vec3 col = mix(uWarm, uHot, pow(facing, 1.8));
        // 头部 4% 渐入：锥体起点是一圈顶点，法线朝径向，
        // 侧视时会在喷口处形成一道硬边亮环，像套了个圆箍
        float head = smoothstep(0.0, 0.04, vT);
        gl_FragColor = vec4(col, fade * rings * soft * head * uIntensity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * 战机材质缓存：同一份原始材质只派生"我方 / 敌方"两套，
 * 所有实例共用，避免每架飞机 clone 25 份材质。
 */
const fighterMats = new WeakMap();
function fighterMaterial(mat, enemy) {
  let entry = fighterMats.get(mat);
  if (!entry) {
    const make = (isEnemy) => {
      const m = mat.clone();
      // 座舱用了 KHR_materials_transmission，three 会为它额外渲染一遍全场景；
      // 一块玻璃不值得这个代价，降级成普通半透明玻璃。
      if (m.transmission && m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.44;
        m.roughness = 0.05;
        m.depthWrite = false;
        m.envMapIntensity = 2.2;
      }

      // ---- 座舱盖 ----
      // glTF 的 Glass 材质默认 metalness=1。玻璃按金属算就成了一块不反光、不透光的灰板，
      // 这是"座舱看着像糊了一块铁皮"的直接原因。
      if (!m.map && /glass/i.test(m.name || '')) {
        m.metalness = 0.1;
        m.roughness = 0.06;
        m.transparent = true;
        m.opacity = Math.min(m.opacity ?? 0.5, 0.46);
        m.depthWrite = false;
        m.envMapIntensity = 2.2;
        return m;
      }

      // ---- 机身蒙皮 ----
      // 这套资产的 baseColor 贴图本身接近纯黑（≈0.05），用基础材质直接贴图也只出剪影，
      // 所以"顺光还是黑的"不是光照问题，是反照率问题。
      // 之前那句 `color × 2.1` 写的是 `!m.emissiveIntensity`——emissiveIntensity 默认就是 1，
      // 取反恒为 false，整个分支从来没执行过；而且白色基色乘 2.1 也救不了 0.05 的贴图。
      // 按真实战机蒙皮标定：反照率抬到中灰（×4.5）、金属度降到哑光漆、粗糙度收到 0.55。
      // 系数实测：×4 是中灰有层次，×7 偏白，×11 冲成纯白丢细节。
      if (m.map) {
        m.color.multiplyScalar(4.5);
        m.metalness = 0.15;
        m.roughness = 0.55;
        m.envMapIntensity = 1.4;
      } else if (m.metalness !== undefined) {
        // 无贴图的小件（起落架、喷口、舱内）：只做金属度上限，避免反射不到环境发黑
        m.metalness = Math.min(m.metalness, 0.55);
        if (m.envMapIntensity !== undefined) {
          m.envMapIntensity = Math.max(m.envMapIntensity || 1, 1.6);
        }
      }

      if (isEnemy && m.color) {
        // 敌我用色调区分，不靠亮度：压成暖红灰，避免和玩家机混在一起
        m.color.multiply(new THREE.Color(0.82, 0.52, 0.46));
      }
      return m;
    };
    entry = { player: make(false), enemy: make(true) };
    fighterMats.set(mat, entry);
  }
  return enemy ? entry.enemy : entry.player;
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
  model.traverse((obj) => {
    // 起落架与弹舱门在飞行状态下收起。
    // 隐身机用 gear*，F-16 资产用 landingOn*（模型自带 landingOff 收起姿态）
    if (obj.name && (obj.name.includes('gear') || /landingOn/i.test(obj.name))) obj.visible = false;
    if (!obj.isMesh || !obj.material) return;
    obj.castShadow = true;
    // 不接收阴影：飞行器在空中只会接收自己的阴影，
    // 而小尺寸物体的自阴影在当前阴影相机精度下会变成满身点状噪点
    obj.receiveShadow = false;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const mapped = list.map((mat) => fighterMaterial(mat, enemy));
    obj.material = Array.isArray(obj.material) ? mapped : mapped[0];
  });

  const root = new THREE.Group();
  root.add(model);

  // ---- 尾焰 ----
  // F-16 资产没有尾焰节点（隐身机的 exhaust 在 buildModernJet 里程序化生成）。
  // 这里踩过三个坑，记下来免得再犯：
  // ① ConeGeometry 是"中心对齐"的：绕 X 转 90° 后，尖端指向 +Z 没错，
  //    但整个锥体的 position.z 也参与 group 的 scale.z 缩放。
  //    而 Game 里用 scale.z 控制火焰长度 → 火焰被压短的同时整体前移，钻回机身里，
  //    表现就是"喷口一片黑，什么都看不见"。
  // ② 所以这里用自定义几何：从 z=0 长到 z=length，起点永远钉在喷口上，
  //    之后 group.scale.z 只改变长度，不会移动起点。
  // ③ 单层锥体在加色混合 + bloom 下会糊成一个球，拆成"白热核心 + 暖色包络"两层。
  const flameGeometry = (radius, length, seg = 16) => {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    }
    const tip = seg + 1;
    pos.push(0, 0, length);
    for (let i = 0; i < seg; i++) idx.push(i, i + 1, tip);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // 喷口实测坐标（把 airframe 顶点换算到机体局部坐标后按 z 切片统计）：
  //   喷口唇口 z ≈ 2.45，截面中心 y ≈ -0.15（机身中轴并不在 y=0）
  // 之前写 (0,0,2.38) 就是"火焰浮在喷口上方还差一截"的原因。
  const NOZZLE_Z = 2.44;
  const NOZZLE_Y = -0.15;

  // 玩家：暖白/琥珀（真实涡扇加力色）；敌方：偏红，靠色相区分
  const hot = new THREE.Color(enemy ? 0xffd6b8 : 0xfff3dc).multiplyScalar(1.7);
  const warm = new THREE.Color(enemy ? 0xff3f18 : 0xff8c3a).multiplyScalar(1.35);

  const flame = new THREE.Group();
  flame.name = 'exhaust';
  flame.position.set(0, NOZZLE_Y, NOZZLE_Z);

  // 内核：细、白热，马赫环清晰。长度按真实加力焰换算：
  // 1 世界单位 = 3.45 m，F-16 加力焰约 4–5 m → 1.2~1.5 单位，环间距约 0.15 单位。
  const coreLen = 0.70;
  const core = new THREE.Mesh(
    flameGeometry(0.078, coreLen),
    flameMaterial(hot, warm.clone().multiplyScalar(1.5), 1.0, coreLen, 26.0, 0.9)
  );
  flame.add(core);

  // 包络：宽、半透明、几乎不带环，只负责柔和的外轮廓
  const plumeLen = 1.00;
  const plume = new THREE.Mesh(
    flameGeometry(0.125, plumeLen),
    flameMaterial(warm, warm, 0.34, plumeLen, 10.0, 0.10)
  );
  flame.add(plume);

  root.add(flame);

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
    // 尾焰必须是 HDR + 加色：亮度推到 4 倍才会被 bloom 挑中，
    // 否则它只是一个"涂成青色的小圆锥"，接不接后期都一样
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(enemy ? 0xff6633 : 0x7ef6ff).multiplyScalar(2.8),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  exhaust.rotation.x = Math.PI / 2;   // +90°：尖端朝机尾（-90° 会把大圆面甩到后面，变成一块贴片）
  exhaust.position.set(0, 0, 1.95);
  exhaust.name = 'exhaust';
  g.add(exhaust);

  const glow = new THREE.PointLight(enemy ? 0xff5522 : 0x66eeff, 1.4, 8, 2);
  glow.position.set(0, 0, 1.7);
  g.add(glow);

  g.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
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

  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  root.userData.kind = kind;
  return root;
}

/**
 * 驱逐舰：真正的三维船体（放样舰体 + 上层建筑 + 主炮 + 烟囱）。
 *
 * 旧做法是把 `assets/destroyer.png` 这张俯视插画摊平贴在甲板高度上——
 * 从上方看还行，一旦视线压低就变成一张漂在水面的贴纸，而且侧舷是切断的。
 * 这里改成沿舰长放样七点横剖面，任何机位都成立。
 */
export function createDestroyer() {
  const L = 54;          // 舰长（世界单位）
  const B = 6.4;         // 舰宽
  const DECK_Y = 2.2;
  const KEEL_Y = -2.4;

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x767f88, metalness: 0.14, roughness: 0.60,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x565e68, metalness: 0.10, roughness: 0.86,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x3b444d, metalness: 0.20, roughness: 0.55,
  });

  const group = new THREE.Group();

  // ---- 舰体放样 ----
  const STATIONS = 26;
  const RINGS = 4;      // 甲板边 / 水线 / 下折 / 龙骨
  const halfWidth = (t) => {
    const bow = THREE.MathUtils.smoothstep(t, 0.0, 0.24);
    const stern = 1 - 0.26 * THREE.MathUtils.smoothstep(t, 0.88, 1.0);
    return (B / 2) * bow * stern;
  };
  const deckHeight = (t) => DECK_Y + 0.55 * Math.pow(1 - t, 2.2);   // 首部舷弧抬高

  // 剖面：右侧从上到下，再镜像到左侧
  const profile = (w, dy) => ([
    [w, dy],
    [w * 0.94, dy - 1.5],
    [w * 0.60, dy - 2.6],
    [0, KEEL_Y],
  ]);

  const verts = [];     // 每条站位：右半 4 点 + 左半 3 点（不含中轴重复点）
  const idx = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const z = -L / 2 + t * L;
    const w = Math.max(0.02, halfWidth(t));
    const dy = deckHeight(t);
    const p = profile(w, dy);
    const right = p.map(([x, y]) => [x, y, z]);
    const left = p.slice(1).reverse().map(([x, y]) => [-x, y, z]);
    verts.push([...right, ...left]);   // 4 + 3 = 7 点
  }
  const RING_PTS = RINGS * 2 - 1;      // 7

  for (let i = 0; i < STATIONS; i++) {
    for (let r = 0; r < RING_PTS - 1; r++) {
      const a = i * RING_PTS + r;
      const b = a + 1;
      const c = (i + 1) * RING_PTS + r;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // 首尾封口（甲板面在下面单独做，这里封首部尖端与尾部横板）
  const posArr = [];
  for (const row of verts) for (const [x, y, z] of row) posArr.push(x, y, z);

  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  hullGeo.setIndex(idx);
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, hullMat);

  // ---- 甲板面 ----
  const deckPos = [];
  const deckIdx = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const w = Math.max(0.02, halfWidth(t));
    const dy = deckHeight(t);
    const z = -L / 2 + t * L;
    deckPos.push(w, dy, z, -w, dy, z);
  }
  for (let i = 0; i < STATIONS; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    deckIdx.push(a, b, c, b, d, c);
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, deckMat);

  group.add(hull, deck);

  // ---- 上层建筑 ----
  const addBox = (w, h, d, x, y, z, mat = hullMat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const bridge = addBox(3.6, 2.6, 7.5, 0, DECK_Y + 1.3, -3.5);
  addBox(3.0, 1.1, 3.2, 0, DECK_Y + 3.1, -5.2);          // 舰桥顶
  addBox(0.25, 2.4, 0.25, 0, DECK_Y + 4.4, -5.6, darkMat); // 桅杆

  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 2.2, 12),
    darkMat
  );
  funnel.position.set(0, DECK_Y + 1.1, 3.0);
  group.add(funnel);

  addBox(2.6, 1.5, 4.0, 0, DECK_Y + 0.75, 8.0, hullMat);   // 后部机库

  // ---- 主炮 ----
  const turret = (z, flip) => {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.9, 10), hullMat);
    base.position.set(0, DECK_Y + 0.45, z);
    group.add(base);
    for (const dx of [-0.42, 0.42]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.0, 6), darkMat);
      barrel.rotation.x = Math.PI / 2 + flip * 0.05;
      barrel.position.set(dx, DECK_Y + 0.62, z + (flip ? 1.9 : -1.9));
      group.add(barrel);
    }
  };
  turret(-16, false);
  turret(16, true);

  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  group.userData.kind = 'destroyer';
  group.userData.length = L;
  return group;
}

export function createCarrier() {
  if (!carrierTemplate) return createShip('carrier');
  const root = new THREE.Group();
  const model = carrierTemplate.clone(true);
  const s = WORLD_PER_METER;
  model.scale.setScalar(s);
  model.rotation.y = Math.PI / 2;
  model.position.set(0, -CARRIER_DRAFT_M * s, CARRIER_CENTER_M * s);
  // 航母原素材在 ACES + 方向光下整体偏暗（甲板非防滑涂层本身是深灰，
  // 侧舷背光面只剩环境光），这里统一提亮一档并加强环境反射。
  // 材质在模板间共享，用标记防止每次重建关卡都重复提亮。
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (m.userData.__tuned) continue;
      m.userData.__tuned = true;
      if (m.color) m.color.multiplyScalar(1.38);
      if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.55;
      if (m.roughness !== undefined) m.roughness = Math.max(0.22, m.roughness * 0.80);
    }
  });
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

/**
 * 海面：读地形高度场做"深度"判断，得到浅滩色、深水色、岸线泡沫，
 * 并在陆地以下直接 discard（水面不再从地形缝里透出来）。
 * 高度图由 bindOceanDepth() 在地形加载完成后注入。
 */
export function createOcean(size = 24000) {
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const map = new THREE.TextureLoader().load('assets/textures/yellow-river.jpg');
  map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const normalMap = new THREE.TextureLoader().load('assets/textures/waternormals.jpg');
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;

  // 未注入高度场前的兜底纹理（1×1，值 0）
  const stub = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
  stub.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uMap: { value: map },
      uNormal: { value: normalMap },
      uHeight: { value: stub },
      uHOrigin: { value: new THREE.Vector2(-1280, -1840) },
      uHExtent: { value: 2560 },
      uHMin: { value: -78 },
      uHRange: { value: 200 },
      uSea: { value: -18 },
      uHasHeight: { value: 0 },
      uScale: { value: 0.0032 },
      uOffset: { value: new THREE.Vector2(0.62, 0.48) },
      uFogColor: { value: new THREE.Color(0xc3dae7) },
      uFogDensity: { value: 0.00055 },
      uShallow: { value: new THREE.Color(0x3f8f8f) },
      uDeep: { value: new THREE.Color(0x14424f) },
      uSky: { value: new THREE.Color(0xa9c6d8) },
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
      uniform sampler2D uHeight;
      uniform vec2 uHOrigin;
      uniform float uHExtent;
      uniform float uHMin;
      uniform float uHRange;
      uniform float uSea;
      uniform float uHasHeight;
      uniform float uScale;
      uniform vec2 uOffset;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      varying vec3 vWorld;

      void main() {
        // 1) 采样地形高度，换算成水深；陆地处 alpha 归零
        float shoreAlpha = 1.0;
        float depth = 999.0;
        if (uHasHeight > 0.5) {
          vec2 huv = (vWorld.xz - uHOrigin) / uHExtent;
          if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) {
            float terrainH = uHMin + texture2D(uHeight, huv).r * uHRange;
            depth = uSea - terrainH;
            // 不要用 discard：它是整像素丢弃，MSAA 对它无效，海岸线会是一排硬台阶。
            // 改成算 alpha，由片元混合出柔和的岸线（配合下面的透明材质）。
            shoreAlpha = smoothstep( -1.2, 2.6, depth );
          }
        }

        // 2) 双频法线，避免单一平铺的"塑料膜"感
        vec3 n1 = texture2D(uNormal, vWorld.xz * 0.085 + vec2(uTime * 0.030, uTime * 0.011)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormal, vWorld.xz * 0.210 - vec2(uTime * 0.019, uTime * 0.043)).xyz * 2.0 - 1.0;
        vec3 normal = normalize(vec3((n1.x + n2.x) * 0.55, 1.0, (n1.y + n2.y) * 0.55));

        // 3) 浅滩 → 深水的颜色过渡
        vec3 water = mix(uShallow, uDeep, smoothstep(1.5, 34.0, depth));

        // 4) 天空反射（菲涅尔）
        vec3 viewDir = normalize(uCam - vWorld);
        float fres = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);

        // 5) 太阳镜面高光
        vec3 sunDir = normalize(vec3(-0.55, 0.78, -0.42));
        float spec = pow(clamp(dot(normal, normalize(sunDir + viewDir)), 0.0, 1.0), 220.0);
        float glint = pow(clamp(dot(normal, normalize(sunDir + viewDir)), 0.0, 1.0), 24.0) * 0.22;

        vec3 color = mix(water, uSky, fres * 0.55);
        color += vec3(1.0, 0.97, 0.90) * spec * 1.6;
        color += vec3(0.85, 0.93, 1.0) * glint;

        // 6) 岸线泡沫：浅水带里随水深和时间抖动
        float foamBand = smoothstep(3.2, 0.3, depth);
        float foamNoise = 0.55 + 0.45 * sin(depth * 5.5 - uTime * 1.6 + n1.x * 3.0);
        float foam = clamp(foamBand * foamNoise, 0.0, 1.0) * 0.75;
        color = mix(color, vec3(0.93, 0.96, 0.96), foam);

        // 7) 大气
        float fogDepth = distance(uCam, vWorld);
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * fogDepth * fogDepth);
        // 远处雾化后不该再透出海底，所以岸线透明只在近处生效
        float nearFade = 1.0 - smoothstep( 300.0, 1400.0, fogDepth );
        float alpha = mix( 1.0, shoreAlpha, nearFade );
        gl_FragColor = vec4( mix( color, uFogColor, fogFactor ), alpha );
      }
    `,
  });
  mat.transparent = true;
  mat.depthWrite = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -18;
  mesh.renderOrder = -1;   // 水面最先画，地形与舰船随后覆盖
  mesh.frustumCulled = false;
  return mesh;
}

/** 地形加载完成后把高度场接到海面上，用于水深/岸线计算 */
export function bindOceanDepth(ocean, field) {
  if (!ocean || !field) return;
  const tex = new THREE.DataTexture(field.data, field.width, field.height, THREE.RedFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const u = ocean.material.uniforms;
  u.uHeight.value = tex;
  u.uHOrigin.value.set(field.originX, field.originZ);
  u.uHExtent.value = field.meta.extent;
  u.uHMin.value = field.minH;
  u.uHRange.value = field.range;
  u.uSea.value = field.seaLevel;
  u.uHasHeight.value = 1;
}

/**
 * 天空：贴图球 + 地平线雾化。
 *
 * 为什么不用 MeshBasicMaterial：远处海面/地形被 FogExp2 染成 #c3dae7，
 * 而天空照片在地平线处更亮，两者接缝会露出一条硬边灰带。
 * 这里把地平线以下按世界方向 y 混向同一个雾色，接缝自然消失。
 */
export function createSky(fogColor = 0xc3dae7) {
  const tex = new THREE.TextureLoader().load('assets/textures/sky.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;

  const geo = new THREE.SphereGeometry(480, 64, 40);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uFogColor: { value: new THREE.Color(fogColor) },
      uHazeStart: { value: 0.02 },
      uHazeEnd: { value: 0.40 },
      // 与 Environment.js 的平行光方向一致（那个值是按这张天空贴图的高光位置定的）
      uSunDir: { value: new THREE.Vector3(-0.55, 0.78, -0.42).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv;
        // 球体只做平移，法线方向即世界方向
        vDir = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform vec3 uSunDir;
      uniform float uHazeStart;
      uniform float uHazeEnd;
      varying vec2 vUv;
      varying vec3 vDir;

      // 天空贴图是 sRGB 编码的。以前直出屏幕时"不解码"刚好被显示端抵消，
      // 接了 HDR 后期后必须显式解码，否则整片天空会被当成线性值再压一次，发灰又发白。
      vec3 srgbToLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
      }

      void main() {
        // 原贴图是水平镜像使用的，这里等价还原
        vec2 uv = vec2(1.0 - vUv.x, vUv.y);
        vec3 c = srgbToLinear(texture2D(uMap, uv).rgb);

        // 解析太阳：贴图里的太阳被采样精度磨成一块钝亮斑，bloom 抓不住。
        // 这里按方向叠一个硬核 + 柔晕，硬核推到 40，是整幅画面唯一稳定的 >1 光源。
        vec3 dir = normalize(vDir);
        float sd = max(dot(dir, uSunDir), 0.0);
        float disc = pow(sd, 3000.0) * 16.0;
        float halo = pow(sd, 120.0) * 1.0;
        float wash = pow(sd, 9.0) * 0.10;
        c += (disc + halo) * vec3(1.0, 0.95, 0.84) + wash * vec3(1.0, 0.92, 0.78);

        float haze = 1.0 - smoothstep(uHazeStart, uHazeEnd, dir.y);
        c = mix(c, uFogColor, haze * 0.92);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

