import * as THREE from 'three';

/**
 * 云层：两层结构
 *
 *   A. 云海（deck）：高空两大片近乎水平的云毯，用可平铺贴图 + 世界坐标 UV，
 *      跟着玩家走但纹理钉在世界坐标上，所以飞过去有视差。远处按距离淡出，
 *      避免出现平面边缘与掠射角的摩尔纹。
 *   B. 积云团（puffs）：18 个团簇 × 8~13 个 billboard 云朵，单次 Instanced 绘制。
 *      位置在 3600 单位的循环网格里 wrap，所以玩家飞多远都有云，且不会越飞越空。
 *
 * 为什么不用 scene.fog：云是亮的漫反射体，按雾衰减 alpha 会直接消失。
 * 这里只把颜色向雾色靠拢，alpha 保持不变。
 *
 * 贴图由 tools/bake-cloud.mjs 离线烘焙：R=明暗，A=覆盖。
 */

const TILE = 7200;                 // 积云环绕周期（世界单位）= 24.8 km（够铺到地平线）
const CLUSTER_COUNT = 42;
const PUFF_MIN = 8;
const PUFF_MAX = 13;
const DECK_Y = [600, 720];         // 云海高度：1.6 km / 2.0 km
const DECK_SIZE = 14000;
const DECK_TILE = 4000;            // 云海贴图的世界周期
const DECK_FADE = 4200;            // 超过这个距离彻底淡出（藏住平面边缘）

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createClouds(opts = {}) {
  const group = new THREE.Group();
  group.name = 'clouds';

  const loader = new THREE.TextureLoader();
  const puffTex = loader.load('assets/textures/cloud-puff.png');
  puffTex.colorSpace = THREE.NoColorSpace;
  puffTex.wrapS = puffTex.wrapT = THREE.ClampToEdgeWrapping;
  puffTex.minFilter = THREE.LinearMipmapLinearFilter;
  puffTex.magFilter = THREE.LinearFilter;
  puffTex.generateMipmaps = true;

  const deckTex = loader.load('assets/textures/cloud-sea.png');
  deckTex.colorSpace = THREE.NoColorSpace;
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.minFilter = THREE.LinearMipmapLinearFilter;
  deckTex.magFilter = THREE.LinearFilter;

  const fogColor = new THREE.Color(opts.fogColor ?? 0xc3dae7);
  const fogDensity = opts.fogDensity ?? 0.00055;

  // ---------------- 积云团 ----------------
  const rand = mulberry32(20261119);
  const puffs = [];
  const clusters = [];
  for (let c = 0; c < CLUSTER_COUNT; c++) {
    // 抖动网格铺满 TILE，避免规则排列
    const gx = (c % 7) / 7 + 0.5 / 7;
    const gz = Math.floor(c / 7) / 6 + 0.5 / 6;
    const cx = (gx + (rand() - 0.5) * 0.11) * TILE;
    const cz = (gz + (rand() - 0.5) * 0.11) * TILE;
    const cy = 250 + rand() * 300;
    const spread = 160 + rand() * 190;
    const count = PUFF_MIN + Math.floor(rand() * (PUFF_MAX - PUFF_MIN + 1));
    clusters.push({ cx, cy, cz });
    for (let p = 0; p < count; p++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * spread;
      puffs.push({
        tx: cx + Math.cos(a) * rr * 1.35,
        ty: cy + (rand() - 0.5) * spread * 0.42,
        tz: cz + Math.sin(a) * rr,
        scale: 150 + rand() * 210,
        seed: rand(),
        opacity: 0.62 + rand() * 0.34,
      });
    }
  }

  const n = puffs.length;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  geo.instanceCount = n;

  const aOffset = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aScale = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const aOpacity = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  aOffset.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) {
    aScale.array[i] = puffs[i].scale;
    aSeed.array[i] = puffs[i].seed;
    aOpacity.array[i] = puffs[i].opacity;
  }
  geo.setAttribute('aOffset', aOffset);
  geo.setAttribute('aScale', aScale);
  geo.setAttribute('aSeed', aSeed);
  geo.setAttribute('aOpacity', aOpacity);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);   // 不做剔除，wrap 后位置会变

  const puffMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: puffTex },
      uLit: { value: new THREE.Color(0xfffaf0) },
      uShadow: { value: new THREE.Color(0x9fb4c8) },
      uFogColor: { value: fogColor },
      uFogDensity: { value: fogDensity },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOffset;
      attribute float aScale;
      attribute float aSeed;
      attribute float aOpacity;

      varying vec2 vUv;
      varying float vDist;
      varying float vOpacity;
      varying float vUp;

      void main() {
        // 四向随机翻转，压掉"同一朵云反复出现"的感觉
        vec2 uv2 = uv;
        if (fract(aSeed * 13.7) > 0.5) uv2.x = 1.0 - uv2.x;
        if (fract(aSeed * 7.3) > 0.5) uv2.y = 1.0 - uv2.y;
        vUv = uv2;
        vOpacity = aOpacity;
        vUp = position.y + 0.5;

        // 世界空间 billboard：法线永远朝相机，puff 不随视角变扁
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = aOffset
          + camRight * position.x * aScale * 1.12
          + camUp * position.y * aScale * 0.88;

        vDist = length(world - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uLit;
      uniform vec3 uShadow;
      uniform vec3 uFogColor;
      uniform float uFogDensity;

      varying vec2 vUv;
      varying float vDist;
      varying float vOpacity;
      varying float vUp;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        float a = tex.a * vOpacity;
        // 贴近相机时淡出：billboard 云一旦糊到近平面，就是一整屏半透明贴片，
        // 边缘会像一块糊掉的胶带。穿云的白化交给下面的 screen veil。
        a *= smoothstep( 12.0, 90.0, vDist );
        if (a < 0.006) discard;

        // 明暗贴图 → 受光/背光两色
        vec3 col = mix(uShadow, uLit, smoothstep(0.04, 0.74, tex.r));
        // 顶部再亮一点（billboard 的上半部分对应真实的受光面）
        col *= 0.94 + 0.10 * vUp;

        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        col = mix(col, uFogColor, fog * 0.70);

        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const puffMesh = new THREE.Mesh(geo, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 12;
  group.add(puffMesh);

  // ---------------- 云海 ----------------
  const deckMeshes = [];
  DECK_Y.forEach((y, i) => {
    const g = new THREE.PlaneGeometry(DECK_SIZE, DECK_SIZE, 1, 1);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: deckTex },
        uLit: { value: new THREE.Color(0xfffdf8) },
        uShadow: { value: new THREE.Color(0xcbdaea) },   // 从下方看到的是云的底面，不该是灰蓝
        uFogColor: { value: fogColor },
        uFogDensity: { value: fogDensity },
        uOrigin: { value: new THREE.Vector2() },
        uTile: { value: DECK_TILE * (i === 0 ? 1 : 0.78) },
        uTime: { value: 0 },
        uOpacity: { value: i === 0 ? 0.96 : 0.55 },
        uFade: { value: DECK_FADE * (i === 0 ? 1 : 0.85) },
        uDrift: { value: i === 0 ? 0.006 : -0.004 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uLit;
        uniform vec3 uShadow;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform vec2 uOrigin;
        uniform float uTile;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uFade;
        uniform float uDrift;

        varying vec3 vWorld;
        varying vec2 vUv;

        void main() {
          // UV 钉在世界坐标上：云毯不跟着玩家滑动，飞过去有视差
          vec2 uv = (vWorld.xz - uOrigin) / uTile + vec2(uTime * uDrift, uTime * uDrift * 0.4);
          vec4 tex = texture2D(uMap, uv);

          float a = tex.a * uOpacity;
          // 按距离淡出：藏住平面边缘，同时避免掠射角的摩尔纹
          vec3 toCam = cameraPosition - vWorld;
          float dist = length( toCam );
          a *= 1.0 - smoothstep(uFade * 0.30, uFade, dist);
          // 近乎平视时云海会变成一整片灰蓝色的"天花板"（看到的是它朝下的底面）。
          // 按视线与水平面的夹角淡出，只保留真正在头顶的云层。
          float graze = 1.0 - abs( normalize( toCam ).y );
          a *= mix( 1.0, 0.10, smoothstep( 0.50, 0.97, graze ) );
          if (a < 0.006) discard;

          vec3 col = mix(uShadow, uLit, smoothstep(0.05, 0.78, tex.r));
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, fog * 0.6);

          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10 + i;
    group.add(mesh);
    deckMeshes.push(mesh);
  });

  // ---------------- 穿云白化（screen veil） ----------------
  // 玩家钻进云里时，单靠 billboard 只会看到贴片边缘；这里按与云团中心的三维距离
  // 叠一层全屏白，读起来才是"冲进云里"。
  const veil = document.createElement('div');
  veil.style.cssText = [
    'position:fixed', 'inset:0', 'pointer-events:none',
    'background:#eef4f8', 'opacity:0', 'z-index:4',
    'transition:opacity 120ms linear',
  ].join(';');
  document.body.appendChild(veil);
  let veilValue = 0;

  // ---------------- 每帧维护 ----------------
  let time = 0;
  let lastX = Infinity;
  let lastZ = Infinity;
  const off = aOffset.array;

  function wrap(v, t) {
    return ((v % t) + t * 1.5) % t - t * 0.5;
  }

  function rebuild(px, pz) {
    for (let i = 0; i < n; i++) {
      const p = puffs[i];
      off[i * 3] = px + wrap(p.tx - px, TILE);
      off[i * 3 + 1] = p.ty;
      off[i * 3 + 2] = pz + wrap(p.tz - pz, TILE);
    }
    aOffset.needsUpdate = true;
  }

  return {
    group,
    puffMesh,
    deckMeshes,
    /** 玩家位置变了才重算 wrap（每 6 单位一次，约每 0.1 秒） */
    update(pos, camera, dt) {
      time += dt || 0;
      const px = pos.x;
      const pz = pos.z;
      if (Math.abs(px - lastX) + Math.abs(pz - lastZ) > 6) {
        rebuild(px, pz);
        lastX = px;
        lastZ = pz;
      }
      // 穿云白化：按"云朵本体"判定，而不是云团中心。
      // 云团半径 300 上下、间距 1000，用中心判定几乎永远碰不到。
      let density = 0;
      for (let i = 0; i < n; i++) {
        const p = puffs[i];
        const dy = p.ty - pos.y;
        if (dy > 260 || dy < -260) continue;          // 高度差太远直接跳过
        const wx = px + wrap(p.tx - px, TILE);
        const dx = wx - px;
        if (dx > 260 || dx < -260) continue;
        const wz = pz + wrap(p.tz - pz, TILE);
        const dz = wz - pz;
        if (dz > 260 || dz < -260) continue;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const r = p.scale * 0.5;
        if (d < r) density += 1 - d / r;
      }
      density = Math.min(0.62, density * 0.30);
      // 只在真的靠近云体时生效，平飞时完全不出现
      veilValue += (density - veilValue) * Math.min(1, (dt || 0.016) * 6);
      if (Math.abs(veilValue) < 0.002) veilValue = 0;
      veil.style.opacity = veilValue.toFixed(3);

      for (const mesh of deckMeshes) {
        mesh.position.x = px;
        mesh.position.z = pz;
        mesh.material.uniforms.uTime.value = time;
        mesh.material.uniforms.uOrigin.value.set(px, pz);
      }
    },
    dispose() {
      veil.remove();
      geo.dispose();
      puffMat.dispose();
      for (const m of deckMeshes) { m.geometry.dispose(); m.material.dispose(); }
      puffTex.dispose();
      deckTex.dispose();
    },
  };
}
