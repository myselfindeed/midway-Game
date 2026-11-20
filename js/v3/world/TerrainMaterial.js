import * as THREE from 'three';

/**
 * 地表材质：单材质，三件事在着色器里完成
 *   1) 双频混合：低频农田卫星图（提供田块结构）× 高频草地细节（提供颗粒）
 *   2) 亮度重映射：卫星图本身是干旱区黄褐，直接当 albedo 会整片荒漠色；
 *      这里只取它的"明暗结构"，重新映射到农田色板（暗部深绿 → 亮部麦黄）
 *   3) 沙滩：由顶点属性 aSand 控制，在着色器里混入沙色，天然没有三角形锯齿
 *
 * TILE_MACRO 决定"田块有多大"，TILE_DETAIL 决定"近看有多细"。
 */
const TILE_MACRO = 380;
const TILE_DETAIL = 22;   // 近景颗粒尺度，太小会碎、太大会糊
const DETAIL_SCALE = 1 / TILE_DETAIL;
const TILE_CLOUD = 3200;  // 云影的世界尺度：一张云图铺 11 km，云影块约 1–2 km
const CLOUD_STRENGTH = 0.55;

function tiled(loader, url, tile, colorSpace = THREE.SRGBColorSpace, mirrored = false) {
  const tex = loader.load(url);
  // 卫星图不是无缝的，镜像平铺可以消掉平铺接缝的硬直线
  tex.wrapS = tex.wrapT = mirrored ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  tex.colorSpace = colorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(1 / tile, 1 / tile);
  return tex;
}

export function createTerrainMaterials() {
  const loader = new THREE.TextureLoader();
  const macro = tiled(loader, 'assets/textures/yellow-river.jpg', TILE_MACRO, THREE.SRGBColorSpace, true);
  const detail = tiled(loader, 'assets/textures/aerial_grass.jpg', TILE_DETAIL);
  const normal = tiled(loader, 'assets/textures/aerial_grass_nor.jpg', TILE_DETAIL, THREE.NoColorSpace);

  // 云影贴图复用烘焙好的云海 alpha：同一次烘焙，不用多一个资源
  const cloud = loader.load('assets/textures/cloud-sea.png');
  cloud.colorSpace = THREE.NoColorSpace;
  cloud.wrapS = cloud.wrapT = THREE.RepeatWrapping;
  cloud.repeat.set(3.2, 3.2);

  // 暴露给 Game 每帧推进的 uniform（云影缓慢飘移）
  const shared = {
    uCloudTime: { value: 0 },
    uCloudTile: { value: TILE_CLOUD },
  };

  const ground = new THREE.MeshStandardMaterial({
    map: macro,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.96,
    metalness: 0.0,
    vertexColors: true,
    dithering: true,
  });

  ground.onBeforeCompile = (shader) => {
    shader.uniforms.tDetail = { value: detail };
    shader.uniforms.uDetailScale = { value: DETAIL_SCALE };
    shader.uniforms.tCloud = { value: cloud };
    shader.uniforms.uCloudTime = shared.uCloudTime;
    shader.uniforms.uCloudTile = shared.uCloudTile;

    shader.vertexShader =
      'attribute float aSand;\nvarying float vSand;\nvarying vec3 vWPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vSand = aSand;'
      );

    shader.fragmentShader =
      'varying float vSand;\nvarying vec3 vWPos;\nuniform sampler2D tDetail;\nuniform float uDetailScale;\nuniform sampler2D tCloud;\nuniform float uCloudTime;\nuniform float uCloudTile;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 macroTexel = texture2D( map, vMapUv );
          vec3 detailTexel = texture2D( tDetail, vWPos.xz * uDetailScale ).rgb;

          // 1) 只取卫星图的明暗结构
          float mLum = dot( macroTexel.rgb, vec3( 0.299, 0.587, 0.114 ) );

          // 2) 重映射到农田色板：深绿 → 黄绿 → 麦黄
          vec3 farm = mix( vec3( 0.075, 0.115, 0.045 ), vec3( 0.30, 0.36, 0.13 ), smoothstep( 0.02, 0.34, mLum ) );
          farm = mix( farm, vec3( 0.56, 0.55, 0.30 ), smoothstep( 0.34, 0.62, mLum ) );

          // 3) 高频细节调制亮度与颗粒
          vec3 vegetated = farm * ( 0.70 + 0.62 * detailTexel * vec3( 0.90, 1.10, 0.85 ) );

          // 4) 沙滩
          vec3 sandCol = vec3( 0.72, 0.66, 0.50 ) * ( 0.82 + 0.40 * detailTexel.r );
          vec3 albedo = mix( vegetated, sandCol, clamp( vSand, 0.0, 1.0 ) );

          diffuseColor.rgb *= albedo;

          // 5) 云影：大尺度云图在世界上空缓慢飘过，地面按同一张图压暗。
          //    这是"活着"的关键——静态光照下地形再细也像模型。
          vec2 cuv = vWPos.xz / uCloudTile + vec2( uCloudTime * 0.0016, uCloudTime * 0.0009 );
          // 云海的 alpha 覆盖率偏低（大片是空隙），直接用作遮罩会出现"零星几块"；
          // 这里放宽映射，让稀薄的云也压出一点影，读起来才是连续飘动的云影
          float cover = smoothstep( 0.04, 0.52, texture2D( tCloud, cuv ).a );
          float cloudShadow = 1.0 - cover * ${CLOUD_STRENGTH.toFixed(2)};
          diffuseColor.rgb *= cloudShadow;
        #endif`
      );
  };
  ground.customProgramCacheKey = () => 'terrain-dual-v3-cloudshadow';

  return { list: [ground], ground, grass: ground, sand: ground, uniforms: shared };
}
