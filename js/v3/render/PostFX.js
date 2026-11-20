import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/**
 * Bloom 后期。
 *
 * 为什么绕不开 composer：
 *   想让"亮的东西"发光，就必须在色调映射**之前**拿到 HDR 亮度（>1.0 的部分）。
 *   直接渲染到屏幕时，three 会在每个材质的着色器里就把亮度压进 0~1，
 *   太阳、尾焰、金属高光全被削平，后期再怎么调也只会把整幅画糊亮。
 *   所以这里改成：场景 → HalfFloat 离屏 → 取亮部做高斯 → OutputPass 统一色调映射 + sRGB。
 *
 * 四个容易踩的坑，这里都处理了：
 *   1. EffectComposer 传自定义 target 时会把 target.width 当成"CSS 宽"，
 *      随后 addPass 再乘一次 pixelRatio → 纹理被放大 dpr 倍，显存直接翻几倍。
 *      所以构造后立刻 setSize() 把内部尺寸校正回 CSS 尺寸。
 *   2. Bloom 是极低频信息，全分辨率跑纯属浪费。半分辨率视觉几乎无差，性能省 4 倍。
 *   3. **HalfFloat + MSAA（samples>0）会在部分帧解析失败，整帧输出全黑。**
 *      实测 2× 和 4× 都会，频率约每 5~10 帧一次，肉眼就是"屏幕一闪一闪"。
 *      这是 Chrome/Metal 下多采样半浮点 render target 的问题，不是本项目代码逻辑。
 *      所以 samples 固定为 0，改用 **FXAA 后期抗锯齿**（放在 OutputPass 之后，在 sRGB 空间做边缘检测）。
 *   4. FXAA 的 resolution 必须是**物理像素**的倒数（1/(w*dpr)），传 CSS 尺寸会让边缘发糊。
 */

const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);

const PRESETS = {
  desktop: {
    // 不能用 MSAA，见文件头第 3 条。抗锯齿交给 FXAA。
    samples: 0,
    // 阈值必须 >1：ACES 前是线性 HDR，1.0 以上才是"光源"。定在 1.0 以下，
    // 白云和海面碎高光会整片被挑走，画面会糊成一层白纱（第一版就栽在这）。
    strength: 0.52,
    radius: 0.56,
    threshold: 0.95,
    bloomScale: 0.5,
    maxPixelRatio: 2,
  },
  mobile: {
    samples: 0,
    strength: 0.34,
    radius: 0.45,
    threshold: 1.02,
    bloomScale: 0.35,
    maxPixelRatio: 1.5,
  },
};

export function isMobileGPU() {
  return IS_MOBILE;
}

export function createPostFX(renderer, scene, camera, opts = {}) {
  const tier = opts.tier || (IS_MOBILE ? 'mobile' : 'desktop');
  const preset = { ...PRESETS[tier], ...opts };

  const size = renderer.getSize(new THREE.Vector2());

  // ① HDR 中间缓冲：HalfFloat 才能留住 >1 的亮部（bloom 的唯一信息源）
  //    ② samples 必须为 0：HalfFloat + MSAA 会间歇性整帧全黑（见文件头第 3 条）
  const hdrTarget = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    samples: preset.samples,
    depthBuffer: true,
    stencilBuffer: false,
  });
  hdrTarget.texture.name = 'PostFX.HDR';

  const composer = new EffectComposer(renderer, hdrTarget);
  // ③ 校正内部尺寸（见文件头第 1 条）
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    preset.strength,
    preset.radius,
    preset.threshold
  );
  // bloom 链降分辨率：mip 顶层本来就是 1/2，再乘 0.5 相当于最细一层 1/4 屏
  const rawSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => {
    rawSetSize(
      Math.max(2, Math.round(w * preset.bloomScale)),
      Math.max(2, Math.round(h * preset.bloomScale))
    );
  };
  composer.addPass(bloom);

  // OutputPass 负责色调映射 + sRGB 编码，让 renderer.toneMapping 在后期管线里继续生效
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // FXAA 放在 tone mapping 之后：边缘检测要在感知均匀的 sRGB 空间做，
  // 在线性 HDR 空间做会把高光边缘判错，出现暗边
  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);

  const syncFxaaResolution = () => {
    const dpr = renderer.getPixelRatio();
    fxaaPass.material.uniforms.resolution.value.set(
      1 / Math.max(1, size.x * dpr),
      1 / Math.max(1, size.y * dpr)
    );
  };
  syncFxaaResolution();

  let enabled = opts.enabled !== false;
  if (new URLSearchParams(location.search).get('bloom') === '0') enabled = false;

  const nope = () => {};

  return {
    composer,
    bloom,
    renderPass,
    fxaaPass,
    tier,
    preset,
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = !!v;
    },
    /** 线上/调试可实时改，例如 __game.postfx.setBloom(0.6, 0.7, 0.8) */
    setBloom(strength, radius, threshold) {
      if (strength !== undefined) bloom.strength = strength;
      if (radius !== undefined) bloom.radius = radius;
      if (threshold !== undefined) bloom.threshold = threshold;
    },
    setSize(w, h) {
      size.set(Math.max(1, w), Math.max(1, h));
      composer.setSize(size.x, size.y);
      syncFxaaResolution();
    },
    setPixelRatio(pr) {
      composer.setPixelRatio(pr);
      syncFxaaResolution();
    },
    render(dt) {
      if (!enabled) {
        // 只是关辉光，不是绕过后期：仍走 composer 才能保证色调映射链路一致，
        // 否则"开/关 bloom"两张图的调性不同，参数根本没法对比
        bloom.enabled = false;
        composer.render(dt);
        bloom.enabled = true;
        return;
      }
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
      hdrTarget.dispose();
      bloom.dispose();
      outputPass.dispose();
      fxaaPass.dispose();
    },
    // 兼容误调用
    update: nope,
  };
}

export { PRESETS as POSTFX_PRESETS };
