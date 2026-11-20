import * as THREE from 'three';

/**
 * 环境光照：天空贴图 → PMREM 环境贴图（IBL）+ 太阳（带自阴影）+ 统一指数雾。
 *
 * 为什么先做这个：
 *   没有 IBL 时金属表面无处可反射，材质只能被压平成"塑料"；
 *   没有阴影时飞行器没有落地/落体的空间关系，画面永远是贴纸。
 *   这两件事是全局收益，地形、战机、舰船会一起"立起来"。
 */

/** 与天空贴图高光位置对齐的太阳方向（画面上方偏左） */
const SUN_DIR = new THREE.Vector3(-0.55, 0.78, -0.42).normalize();
const SHADOW_EXTENT = 620;  // 阴影相机半宽（世界单位）：要覆盖山体互相投影，44 只够拍到飞行器
const SUN_DISTANCE = 90;

export function createEnvironment(scene, renderer, sky, opts = {}) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---- IBL：用现有天空贴图烘环境贴图，反射与背景天然一致 ----
  let envTexture = null;
  const skyMap = sky && sky.material && sky.material.map;
  if (skyMap && skyMap.image) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const equirect = skyMap.clone();
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.wrapS = equirect.wrapT = THREE.ClampToEdgeWrapping;
    equirect.repeat.set(1, 1);
    equirect.offset.set(0, 0);
    equirect.needsUpdate = true;
    const rt = pmrem.fromEquirectangular(equirect);
    envTexture = rt.texture;
    scene.environment = envTexture;
    equirect.dispose();
    pmrem.dispose();
  }

  // ---- 光照：太阳主导，天空补光只做托底 ----
  const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x2a4a66, opts.hemi ?? 0.35);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d8, opts.sun ?? 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);   // 620×2/2048 ≈ 0.6 单位/texel（约 2 m）
  const d = opts.shadowExtent ?? SHADOW_EXTENT;
  const cam = sun.shadow.camera;
  cam.left = -d;
  cam.right = d;
  cam.top = d;
  cam.bottom = -d;
  cam.near = 1;
  cam.far = 320;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0012;
  // 范围放大后单位/texel 也放大了 14 倍，法线偏移必须跟着放大，否则大面积阴影痤疮
  sun.shadow.normalBias = 1.1;
  scene.add(sun);
  scene.add(sun.target);

  // 极弱补光，只为了让机腹不死黑
  const fill = new THREE.DirectionalLight(0xa8c8ff, opts.fill ?? 0.22);
  fill.position.set(-40, 30, -20);
  scene.add(fill);

  // ---- 统一大气：指数雾，颜色取地平线色 ----
  const fogColor = new THREE.Color(opts.fogColor ?? 0xc3dae7);
  const fogDensity = opts.fogDensity ?? 0.00055;
  scene.fog = new THREE.FogExp2(fogColor, fogDensity);

  const tmp = new THREE.Vector3();

  return {
    sun,
    hemi,
    fill,
    envTexture,
    fogColor,
    fogDensity,
    /** 每帧把阴影相机与太阳绑到飞行器附近，保证阴影分辨率 */
    update(targetPos) {
      tmp.copy(targetPos).addScaledVector(SUN_DIR, SUN_DISTANCE);
      sun.position.copy(tmp);
      sun.target.position.copy(targetPos);
      sun.target.updateMatrixWorld();
    },
  };
}
