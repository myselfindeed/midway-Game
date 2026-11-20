#!/usr/bin/env node
/**
 * 烘焙空战音效（离线合成，运行时只读 WAV）
 *
 *   assets/audio/missile-launch.wav   导弹发射（挂架释放 → 点火 → 低频冲击 → 火箭尾焰呼啸）
 *   assets/audio/explosion-air.wav    战机凌空爆炸（起爆脆响 → 次低频 boom → 碎片 → 混响尾）
 *
 * 为什么离线烘而不是运行时用振荡器拼：
 *   之前的实现是几十行 Web Audio 节点实时合成，只有 1~2 层，听起来像"电子音效"。
 *   真实录音的信息量来自**层层叠加的瞬态**（点火脆响、压力波、燃烧不稳定产生的噼啪、
 *   离开时的空气吸收）和**随时间变化的频谱重心**。这些必须逐采样算，浏览器里算不起，
 *   所以在 Node 里逐采样合成好，游戏里只做播放、变调和空间化。
 *
 * 采样率 32 kHz：内容全在 16 kHz 以下（高空空气吸收会把更高频削掉，真实录音也是这样）。
 * 立体声 16bit，两段合计约 790 KB。
 *
 * 调音方法：先看 `起音 0-150ms` 的频谱平衡（决定"砸不砸"），再看 `尾段 150ms+`
 * （决定"厚不厚"）。低频体感天然比中频响 20 dB 以上，一次性积分会把瞬态淹掉，
 * 所以必须分窗口看，否则很容易把声音调成一坨闷响。
 *
 * 用法：node tools/bake-sfx.mjs [--spectrogram]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SR = 32000;
const OUT_DIR = 'assets/audio';

// ---------------------------------------------------------------- 基础工具

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** 白噪声；'pink' 用 Paul Kellet 滤波，'brown' 用带泄漏的积分 */
function makeNoise(n, seed, color = 'white') {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  if (color === 'white') {
    for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
      out[i] = last * 3.5;
    }
  }
  return out;
}

/** RBJ biquad；系数每 32 采样更新一次即可，不必逐采样三角函数 */
class Biquad {
  constructor(type, f0, Q = 0.707, gainDb = 0) {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    this.set(type, f0, Q, gainDb);
  }
  set(type, f0, Q = 0.707, gainDb = 0) {
    const w0 = (2 * Math.PI * clamp(f0, 10, SR * 0.45)) / SR;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'peaking') {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else if (type === 'highshelf') {
      const A = Math.pow(10, gainDb / 40);
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - s;
    } else throw new Error('biquad: ' + type);
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** 控制速率的平滑随机游走：模拟燃烧抖动 / 火焰翻卷 */
class ControlWalk {
  constructor(n, rate, seed) {
    this.rate = rate;
    const len = Math.ceil((n / SR) * rate) + 4;
    this.arr = new Float32Array(len);
    const rng = mulberry32(seed);
    let v = 0.5;
    for (let i = 0; i < len; i++) {
      v += (rng() * 2 - 1) * 0.42;
      v = clamp(v, 0, 1);
      this.arr[i] = v;
    }
  }
  at(t) {
    const x = t * this.rate;
    const i = Math.min(this.arr.length - 2, Math.floor(x));
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return this.arr[i] * (1 - s) + this.arr[i + 1] * s;
  }
}

// 起音淡入：文件第一个采样直接从 0 跳到满幅会产生直流阶跃（听感是"啪"的直流声）。
// 1~2 ms 足够消掉，短到听不出，也不影响瞬态的锐度。
function fadeIn(buf, seconds) {
  const n = Math.min(buf.length, Math.floor(seconds * SR));
  for (let i = 0; i < n; i++) buf[i] *= smoothstep(i / n);
}

function fadeOut(buf, seconds) {
  const n = Math.min(buf.length, Math.floor(seconds * SR));
  const s0 = buf.length - n;
  for (let i = 0; i < n; i++) {
    const g = 1 - smoothstep(i / n);
    buf[s0 + i] *= g;
  }
}

function normalize(chans, target = 0.95) {
  let p = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  if (p < 1e-9) return 0;
  const g = target / p;
  for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g;
  return g;
}

// ---------------------------------------------------------------- 导弹发射

/**
 * 时间线（t=0 为挂架解锁）：
 *   0.000  挂架释放——机械闷响 + 金属咔哒，很轻，但决定了"发射"这个动作感
 *   0.035  点火——极短宽带脆响，是整段里最响的瞬态
 *   0.035  压力波——32→110 Hz 的正弦，tanh 饱和出谐波，小喇叭也放得出来
 *   0.035  火箭尾焰——三层噪声（低频体 / 中频芯 / 高频撕裂）+ 燃烧噼啪
 *   2.900  结束（导弹已飞远，只剩被空气吸收过的残响）
 */
function bakeMissile() {
  const dur = 2.9;
  const N = Math.floor(dur * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  const whiteL = makeNoise(N, 0x51a7, 'white');
  const whiteR = makeNoise(N, 0x51b8, 'white');
  const pinkL = makeNoise(N, 0x51c9, 'pink');
  const pinkR = makeNoise(N, 0x51da, 'pink');
  const brown = makeNoise(N, 0x51eb, 'brown');

  const T_IGNITE = 0.035;

  // 各层增益集中在这里，方便反复试听调整。数值是"起音窗口频谱平衡"调出来的：
  // 中频必须给得比直觉大得多，否则一坨低频闷响，听不出是"火箭"。
  const G = {
    release: 0.30,
    ignite: 0.62,
    whump: 0.55,       // 低频冲击（体感）
    pressure: 0.55,    // 低频尘（厚度）
    roarBody: 1.20,
    roarMid: 5.20,     // 尾焰中频芯：气势主要来自这里
    roarHi: 1.00,      // 撕裂感
    crackle: 1.35,
    hiss: 0.28,
  };

  // ---- ① 挂架释放：两声几乎重叠的机械响
  {
    const bp = new Biquad('bandpass', 1600, 2.4);
    const bp2 = new Biquad('bandpass', 3400, 3.2);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if (t > 0.16) break;
      const e1 = Math.exp(-t / 0.010);
      const e2 = t > 0.018 ? Math.exp(-(t - 0.018) / 0.007) : 0;
      const thump = Math.sin(2 * Math.PI * 118 * t) * Math.exp(-t / 0.030);
      const v = (bp.process(whiteL[i]) * e1 + bp2.process(whiteR[i]) * e2 * 0.6 + thump * 0.4) * G.release;
      L[i] += v;
      R[i] += v * 0.9;
    }
  }

  // ---- ② 点火脆响：1.5 ms 起音、11 ms 衰减
  {
    const hp = new Biquad('highpass', 1400, 0.75);
    const pk = new Biquad('peaking', 3200, 1.1, 7);
    for (let i = 0; i < N; i++) {
      const tt = i / SR - T_IGNITE;
      if (tt < 0) continue;
      if (tt > 0.3) break;
      const e = Math.min(1, tt / 0.0015) * Math.exp(-tt / 0.011);
      const v = Math.tanh(pk.process(hp.process(whiteL[i])) * 2.6) * e * G.ignite;
      L[i] += v;
      R[i] += v * 0.94;
    }
  }

  // ---- ③ 压力波：发射瞬间胸口被推一下的那个"咚"
  {
    let phase = 0;
    for (let i = 0; i < N; i++) {
      const tt = i / SR - T_IGNITE;
      if (tt < 0) continue;
      const f = 30 + 82 * Math.exp(-tt * 2.4);
      phase += (2 * Math.PI * f) / SR;
      const e = smoothstep(tt / 0.012) * Math.exp(-tt / 0.19);
      const v = Math.tanh(Math.sin(phase) * 2.4) * e * G.whump;
      L[i] += v;
      R[i] += v;
    }
  }

  // ---- ④ 压力波的低频尘：让"咚"有厚度而不是一个纯音
  {
    const lp = new Biquad('lowpass', 110, 0.7);
    for (let i = 0; i < N; i++) {
      const tt = i / SR - T_IGNITE;
      if (tt < 0) continue;
      const e = smoothstep(tt / 0.02) * Math.exp(-tt / 0.32);
      const v = lp.process(brown[i]) * e * G.pressure;
      L[i] += v;
      R[i] += v;
    }
  }

  // ---- ⑤ 火箭尾焰主体：三层 + 燃烧抖动
  //      这是离线合成相对实时节点最大的优势：三层截止频率都在随时间扫动
  {
    const lpL = new Biquad('lowpass', 900, 0.6);
    const lpR = new Biquad('lowpass', 900, 0.6);
    const bpL = new Biquad('bandpass', 1100, 0.5);
    const bpR = new Biquad('bandpass', 1100, 0.5);
    const hpL = new Biquad('highpass', 2400, 0.7);
    const hpR = new Biquad('highpass', 2400, 0.7);
    const cwL = new ControlWalk(N, 40, 0x9a11);
    const cwR = new ControlWalk(N, 40, 0x9a22);

    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const tt = t - T_IGNITE;
      if (tt < 0) continue;
      if ((i & 31) === 0) {
        const p = Math.min(1, tt / 2.55);
        const bodyF = 130 + 820 * Math.pow(0.22, p);
        const midF = 260 + 1000 * Math.pow(0.28, p);
        lpL.set('lowpass', bodyF, 0.6);
        lpR.set('lowpass', bodyF, 0.6);
        bpL.set('bandpass', midF, 0.5);
        bpR.set('bandpass', midF, 0.5);
      }
      const rise = smoothstep(Math.min(1, tt / 0.03));
      const env = rise * (0.09 + 0.91 * Math.exp(-Math.max(0, tt - 0.22) / 0.60));
      const flutter = 0.80 + 0.16 * Math.sin(2 * Math.PI * 13.3 * tt) + 0.12 * Math.sin(2 * Math.PI * 27.7 * tt + 1.7);
      const amL = flutter * (0.62 + 0.62 * cwL.at(t));
      const amR = flutter * (0.62 + 0.62 * cwR.at(t));
      L[i] += (lpL.process(brown[i]) * G.roarBody + bpL.process(pinkL[i]) * G.roarMid + hpL.process(whiteL[i]) * G.roarHi) * env * amL * 0.34;
      R[i] += (lpR.process(brown[i]) * G.roarBody + bpR.process(pinkR[i]) * G.roarMid + hpR.process(whiteR[i]) * G.roarHi) * env * amR * 0.34;
    }
  }

  // ---- ⑥ 燃烧噼啪：真实火箭噪声里那种"撕裂"的颗粒感
  //      没有这一层，再怎么叠噪声都只是一条平顺的"呼——"
  {
    const rng = mulberry32(0x7c3d);
    let t = T_IGNITE + 0.015;
    const end = dur - 0.12;
    while (t < end) {
      const tt = t - T_IGNITE;
      const rate = 26 + 240 * Math.exp(-tt / 1.25);
      t += -Math.log(1 - rng() * 0.999) / rate;
      if (t >= end) break;
      const i0 = Math.floor(t * SR);
      const len = Math.floor((0.0010 + rng() * 0.0022) * SR);
      const bp = new Biquad('bandpass', 1200 + rng() * 4200, 1.5);
      const amp = (0.05 + rng() * 0.20) * Math.exp(-tt / 1.15) * smoothstep(tt / 0.08) * G.crackle;
      const pan = rng() * 2 - 1;
      const gl = Math.sqrt(0.5 * (1 - pan));
      const gr = Math.sqrt(0.5 * (1 + pan));
      const tau = 0.00035 + rng() * 0.0005;
      for (let k = 0; k < len && i0 + k < N; k++) {
        const e = Math.exp(-(k / SR) / tau);
        const v = Math.tanh(bp.process(whiteL[i0 + k]) * 2.2) * e * amp;
        L[i0 + k] += v * gl * 1.4;
        R[i0 + k] += v * gr * 1.4;
      }
      t += 0.0015;
    }
  }

  // ---- ⑦ 燃气嘶声：高压气体喷出的高频尾巴
  {
    const hpL = new Biquad('highpass', 3600, 0.8);
    const hpR = new Biquad('highpass', 3600, 0.8);
    for (let i = 0; i < N; i++) {
      const tt = i / SR - T_IGNITE;
      if (tt < 0) continue;
      const e = smoothstep(Math.min(1, tt / 0.06)) * Math.exp(-tt / 0.34);
      L[i] += hpL.process(whiteR[i]) * e * G.hiss;
      R[i] += hpR.process(whiteL[i]) * e * G.hiss;
    }
  }

  // ---- ⑧ 存在感补偿：1.2 kHz 附近抬一点，让声音"从背景音乐里冒出来"
  {
    const pL = new Biquad('peaking', 1250, 1.0, 4.5);
    const pR = new Biquad('peaking', 1250, 1.0, 4.5);
    for (let i = 0; i < N; i++) {
      L[i] = pL.process(L[i]);
      R[i] = pR.process(R[i]);
    }
  }

  // ---- ⑨ 空气吸收：导弹离机后高频先走，这是"飞走了"最重要的听感线索
  {
    const gL = new Biquad('lowpass', 15000, 0.7);
    const gR = new Biquad('lowpass', 15000, 0.7);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      if ((i & 31) === 0) {
        // 按秒数衰减（不是按比例）：0 s→15k，0.3 s→9k，1 s→3k，2 s→1.2k
        const f = 800 + 13000 * Math.exp(-(p * dur) / 0.42);
        gL.set('lowpass', f, 0.7);
        gR.set('lowpass', f, 0.7);
      }
      const dist = 1 - 0.58 * smoothstep(p * 1.15);
      L[i] = gL.process(L[i]) * dist;
      R[i] = gR.process(R[i]) * dist;
    }
  }

  fadeIn(L, 0.002);
  fadeIn(R, 0.002);
  fadeOut(L, 0.45);
  fadeOut(R, 0.45);

  normalize([L, R], 0.94);
  return { L, R, dur };
}

// ---------------------------------------------------------------- 战机爆炸

/** Schroeder 混响：4 梳状 + 2 全通，给爆炸一个"室外空间" */
function reverb(input, delayScale, seed, feedback = 0.80) {
  const out = new Float32Array(input.length);
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round(d * delayScale));
  const aps = [225, 556].map((d) => Math.round(d * delayScale));
  const buffers = combs.map((d) => new Float32Array(d));
  const idxs = combs.map(() => 0);
  const damp = combs.map(() => 0);
  const rng = mulberry32(seed);
  const apBufs = aps.map((d) => new Float32Array(d));
  const apIdx = aps.map(() => 0);
  const fb = feedback;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    let s = 0;
    for (let c = 0; c < combs.length; c++) {
      const y = buffers[c][idxs[c]];
      damp[c] = y * 0.72 + damp[c] * 0.28;      // 梳状内的阻尼低通：高频先死
      buffers[c][idxs[c]] = x * 0.25 + damp[c] * fb;
      idxs[c] = (idxs[c] + 1) % combs[c];
      s += y;
    }
    s *= 0.25;
    for (let a = 0; a < aps.length; a++) {
      const b = apBufs[a];
      const j = apIdx[a];
      const y = b[j];
      const v = s + y * -0.5;
      b[j] = s + y * 0.5;
      apIdx[a] = (j + 1) % aps[a];
      s = v;
    }
    out[i] = s * 0.9 + (rng() - 0.5) * 0.00002;
  }
  return out;
}

/**
 * 时间线：
 *   0.000  起爆——0.6 ms 起音、7.5 ms 衰减的宽带脆响，是"炸了"的判定点
 *   0.000  爆轰亮层——宽带噪声低通 5.5 kHz、45 ms 衰减，负责 0~60 ms 的"炸裂"
 *   0.000  中频爆轰——2.6 kHz 扫到 600 Hz
 *   0.000  次低频 boom——24~86 Hz 正弦，tanh 饱和，0.52 s + 1.45 s 双段衰减
 *   0.05   碎片与二次爆燃——泊松分布随机脆响，持续到 1.8 s
 *   0.15   火球膨胀的低频"呼"
 *   全程   Schroeder 混响尾
 */
function bakeExplosion() {
  const dur = 2.6;
  const N = Math.floor(dur * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  const whiteL = makeNoise(N, 0x2f11, 'white');
  const whiteR = makeNoise(N, 0x2f22, 'white');
  const pinkL = makeNoise(N, 0x2f33, 'pink');
  const pinkR = makeNoise(N, 0x2f44, 'pink');
  const brown = makeNoise(N, 0x2f55, 'brown');

  // 同样按"起音窗口"调：爆炸最容易犯的错就是只剩一记闷雷，没有"炸"的脆
  const G = {
    crack: 4.60,       // 起爆脆响
    blast: 3.60,       // 0~60 ms 宽带亮层
    boomMid: 4.20,     // 中频爆轰
    punch: 0.66,       // 可听的低频推力（小喇叭上"重"就靠这一层）
    sub: 1.15,         // 次低频 boom
    lowDust: 0.82,     // 低频尘
    fireball: 0.62,    // 火球膨胀
    debris: 1.70,
  };

  // ---- ① 起爆脆响
  {
    const hp = new Biquad('highpass', 850, 0.72);
    const pk = new Biquad('peaking', 2400, 1.0, 6);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if (t > 0.25) break;
      const e = Math.min(1, t / 0.0006) * Math.exp(-t / 0.0075);
      const v = Math.tanh(pk.process(hp.process(whiteL[i])) * 3.0) * e * G.crack;
      L[i] += v;
      R[i] += v * 0.92;
    }
  }

  // ---- ② 0~60 ms 宽带亮层：这一段决定了"炸"而不是"闷"
  {
    const lpL = new Biquad('lowpass', 5600, 0.7);
    const lpR = new Biquad('lowpass', 5600, 0.7);
    const hpL = new Biquad('highpass', 260, 0.7);
    const hpR = new Biquad('highpass', 260, 0.7);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if (t > 0.3) break;
      if ((i & 31) === 0) {
        const f = 1600 + 4400 * Math.exp(-t * 32);
        lpL.set('lowpass', f, 0.7);
        lpR.set('lowpass', f, 0.7);
      }
      const e = Math.min(1, t / 0.0012) * Math.exp(-t / 0.026);
      L[i] += hpL.process(lpL.process(whiteL[i])) * e * G.blast;
      R[i] += hpR.process(lpR.process(whiteR[i])) * e * G.blast;
    }
  }

  // ---- ③ 爆轰中频：频谱重心从 2.6 kHz 掉到 600 Hz
  {
    const bpL = new Biquad('bandpass', 2600, 0.6);
    const bpR = new Biquad('bandpass', 2600, 0.6);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if ((i & 31) === 0) {
        const f = 560 + 2200 * Math.exp(-t * 3.0);
        bpL.set('bandpass', f, 0.6);
        bpR.set('bandpass', f, 0.6);
      }
      const e = Math.min(1, t / 0.004) * Math.exp(-t / 0.085);
      L[i] += bpL.process(pinkL[i]) * e * G.boomMid;
      R[i] += bpR.process(pinkR[i]) * e * G.boomMid;
    }
  }

  // ---- ③b 低频推力：60→38 Hz 的短促一击
  //      24 Hz 的次低频只有大箱体放得出来，手机和笔记本上真正能"推"到人的
  //      是 40~90 Hz 这一段。单独补一层，饱和得更狠一点，补偿小喇叭的滚降。
  {
    let phase = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const f = 38 + 24 * Math.exp(-t * 9);
      phase += (2 * Math.PI * f) / SR;
      const e = smoothstep(t / 0.004) * Math.exp(-t / 0.20);
      const v = Math.tanh(Math.sin(phase) * 3.6) * e * G.punch;
      L[i] += v;
      R[i] += v;
    }
  }

  // ---- ④ 次低频 boom：爆炸的"重量"全在这一层
  {
    let phase = 0;
    let phase2 = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const f = 21 + 58 * Math.exp(-t * 3.2);
      phase += (2 * Math.PI * f) / SR;
      phase2 += (2 * Math.PI * (f * 1.52)) / SR;
      const e = smoothstep(t / 0.006) * (0.80 * Math.exp(-t / 0.40) + 0.34 * Math.exp(-t / 0.95));
      // tanh 饱和：压峰值的同时造出 48~170 Hz 的谐波，
      // 小喇叭放不出 30 Hz，全靠谐波让人"觉得"有低频
      const s = Math.tanh(Math.sin(phase) * 3.4) * 0.72 + Math.tanh(Math.sin(phase2) * 1.9) * 0.28;
      const v = s * e * G.sub;
      L[i] += v;
      R[i] += v;
    }
  }

  // ---- ⑤ 爆心低频尘
  {
    const lpL = new Biquad('lowpass', 165, 0.66);
    const lpR = new Biquad('lowpass', 165, 0.66);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if ((i & 31) === 0) {
        const f = 62 + 96 * Math.exp(-t * 2.4);
        lpL.set('lowpass', f, 0.66);
        lpR.set('lowpass', f, 0.66);
      }
      const e = Math.min(1, t / 0.010) * Math.exp(-t / 0.34);
      L[i] += lpL.process(brown[i]) * e * G.lowDust;
      R[i] += lpR.process(brown[i]) * e * G.lowDust;
    }
  }

  // ---- ⑥ 火球膨胀的"呼"：0.15 s 才起来，给爆炸一个体积感
  {
    const lpL = new Biquad('lowpass', 700, 0.7);
    const lpR = new Biquad('lowpass', 700, 0.7);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      if ((i & 31) === 0) {
        const f = 240 + 560 * Math.exp(-t * 1.8);
        lpL.set('lowpass', f, 0.7);
        lpR.set('lowpass', f, 0.7);
      }
      const e = smoothstep(t / 0.10) * Math.exp(-Math.max(0, t - 0.10) / 0.40);
      L[i] += lpL.process(pinkL[i]) * e * G.fireball;
      R[i] += lpR.process(pinkR[i]) * e * G.fireball;
    }
  }

  // ---- ⑦ 碎片 / 二次爆燃：油料和弹药在 1.8 s 内陆续殉爆
  {
    const rng = mulberry32(0x3d71);
    let t = 0.045;
    const end = 1.15;
    while (t < end) {
      const rate = 10 + 80 * Math.exp(-t / 0.28);
      t += -Math.log(1 - rng() * 0.999) / rate;
      if (t >= end) break;
      const i0 = Math.floor(t * SR);
      const isBig = rng() < 0.13;
      const len = Math.floor((isBig ? 0.006 + rng() * 0.010 : 0.0015 + rng() * 0.004) * SR);
      const bp = new Biquad('bandpass', 500 + rng() * 3000, isBig ? 1.1 : 2.0);
      const amp = (isBig ? 0.16 + rng() * 0.22 : 0.04 + rng() * 0.11) * Math.exp(-t / 0.75) * G.debris;
      const pan = rng() * 2 - 1;
      const gl = Math.sqrt(0.5 * (1 - pan));
      const gr = Math.sqrt(0.5 * (1 + pan));
      const tau = 0.0004 + rng() * 0.0012;
      for (let k = 0; k < len && i0 + k < N; k++) {
        const e = Math.exp(-(k / SR) / tau);
        const v = Math.tanh(bp.process(whiteL[i0 + k]) * 2.4) * e * amp;
        L[i0 + k] += v * gl;
        R[i0 + k] += v * gr;
      }
      t += 0.0012;
    }
  }

  // ---- ⑧ 混响：把爆炸放进空气里，否则像是在消声室放的采样
  {
    const dry = new Float32Array(N);
    for (let i = 0; i < N; i++) dry[i] = (L[i] + R[i]) * 0.5;
    const wetA = reverb(dry, SR / 44100, 0x8811, 0.72);
    const wetB = reverb(dry, (SR / 44100) * 1.07, 0x8822, 0.72);
    const w = 0.28;
    for (let i = 0; i < N; i++) {
      L[i] = L[i] * (1 - w * 0.5) + wetA[i] * w;
      R[i] = R[i] * (1 - w * 0.5) + wetB[i] * w;
    }
  }

  // ---- ⑨ 高空空气吸收：3 kHz 以上削掉大半，避免"炸得太尖"
  {
    const lpL = new Biquad('lowpass', 6800, 0.66);
    const lpR = new Biquad('lowpass', 6800, 0.66);
    const hsL = new Biquad('highshelf', 4200, 0.7, -4);
    const hsR = new Biquad('highshelf', 4200, 0.7, -4);
    const pkL = new Biquad('peaking', 1100, 1.0, 3.0);
    const pkR = new Biquad('peaking', 1100, 1.0, 3.0);
    for (let i = 0; i < N; i++) {
      L[i] = pkL.process(hsL.process(lpL.process(L[i])));
      R[i] = pkR.process(hsR.process(lpR.process(R[i])));
    }
  }

  // 软限幅（整段）：爆炸的峰值来自起爆瞬间，直接归一化会让"boom"听起来很轻。
  // tanh 压掉尖峰、把体感抬上来，相当于一个 4:1 的压限器，顺带做出爆炸的密度。
  {
    const drive = 1.35;
    const norm = Math.tanh(drive);
    for (let i = 0; i < N; i++) {
      L[i] = Math.tanh(L[i] * drive) / norm;
      R[i] = Math.tanh(R[i] * drive) / norm;
    }
  }

  // 尾部淡出。方向必须是 1→0：写成 smoothstep(i/fade) 就是从 0 开始，
  // 等于在第 (N-fade) 个采样上把振幅一步砍到 0，会有一声很明显的"咔"。
  // 频谱图上就是一条贯穿全频段的竖线 + 后面一块 1/f 拖尾。
  fadeIn(L, 0.0015);
  fadeIn(R, 0.0015);
  fadeOut(L, 0.3);
  fadeOut(R, 0.3);

  normalize([L, R], 0.96);
  return { L, R, dur };
}

// ---------------------------------------------------------------- WAV

function writeWav(path, chans, sr) {
  const n = chans[0].length;
  const ch = chans.length;
  const blockAlign = ch * 2;
  const dataSize = n * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = clamp(chans[c][i], -1, 1);
      buf.writeInt16LE(Math.round(v * 32767), off);
      off += 2;
    }
  }
  writeFileSync(path, buf);
  return buf.length;
}

// ---------------------------------------------------------------- 分析

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function analyze(name, chans, dur) {
  const N = chans[0].length;
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (const c of chans) s += c[i];
    mono[i] = s / chans.length;
  }
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    sumSq += mono[i] * mono[i];
  }
  const rms = Math.sqrt(sumSq / N);
  // 最响 100 ms 窗口的 RMS：用来把"发射"和"爆炸"的冲击力拉到同一档，
  // 否则只看全程 RMS，拖得长的那段会被判成更响
  let loudest = 0;
  const W100 = Math.floor(0.1 * SR);
  for (let s0 = 0; s0 + W100 < N; s0 += W100) {
    let acc = 0;
    for (let i = s0; i < s0 + W100; i++) acc += mono[i] * mono[i];
    loudest = Math.max(loudest, Math.sqrt(acc / W100));
  }
  console.log(`\n=== ${name} ===`);
  console.log(`时长 ${dur.toFixed(2)}s  峰值 ${peak.toFixed(3)}  RMS ${rms.toFixed(4)}  峰均比 ${(20 * Math.log10(peak / rms)).toFixed(1)} dB  最响100ms RMS ${loudest.toFixed(3)}`);

  // 按时间段看"频谱重心"（centroid）：这是判断"脆 / 闷"最直接的指标。
  // 一次爆炸的起音 50 ms 内重心应在 1.5~3 kHz；如果只有两三百赫兹，那就是一记闷雷。
  // 第一段必须从 0 开始：起爆瞬态只有 8 ms，从 25 ms 起算等于完全看不到它，
  // 会误判成"没有脆度"。
  const slices = [
    ['0-32ms', 0, 0.032],
    ['32-100ms', 0.032, 0.1],
    ['0.1-0.3s', 0.1, 0.3],
    ['0.3-0.8s', 0.3, 0.8],
    ['0.8-1.5s', 0.8, 1.5],
    ['1.5s-尾', 1.5, 99],
  ];
  console.log('时间片  频谱重心   各倍频程相对电平（以最响一倍频程为 0 dB）');
  for (const [label, a, b] of slices) {
    const s0 = Math.floor(a * SR);
    const s1 = Math.min(N, Math.floor(b * SR));
    // 短窗口用 512 点（16 ms），否则 1024 点根本放不进 32 ms 里
    const W = s1 - s0 < 2500 ? 512 : 1024;
    if (s1 - s0 < W) continue;
    const acc = new Float64Array(W / 2);
    let frames = 0;
    for (let s = s0; s + W < s1; s += W / 2) {
      const re = new Float64Array(W);
      const im = new Float64Array(W);
      for (let i = 0; i < W; i++) re[i] = mono[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W));
      fft(re, im);
      for (let i = 1; i < W / 2; i++) acc[i] += (re[i] * re[i] + im[i] * im[i]) / (frames + 1);
      frames++;
    }
    // centroid 用总能量加权
    let num = 0;
    let den = 0;
    for (let i = 1; i < W / 2; i++) {
      const f = (i * SR) / W;
      num += f * acc[i];
      den += acc[i];
    }
    const centroid = den > 1e-12 ? num / den : 0;

    const octs = [];
    for (let lo = 31.5; lo < 16000; lo *= 2) {
      const hi = lo * 2;
      let e = 0;
      for (let i = Math.floor((lo * W) / SR); i < Math.min(W / 2, Math.ceil((hi * W) / SR)); i++) e += acc[i];
      octs.push([lo, 10 * Math.log10(e + 1e-12)]);
    }
    const ref = Math.max(...octs.map((o) => o[1]));
    const bars = octs
      .map(([lo, db]) => {
        const v = clamp((db - ref + 54) / 54, 0, 1);
        const ch = ' .:-=+*#%@'[Math.min(9, Math.round(v * 9))];
        return ch;
      })
      .join('');
    console.log(`  ${label.padEnd(9)} ${centroid.toFixed(0).padStart(6)} Hz   ${bars}   (32→16k)`);
  }

  console.log('包络（每 0.1 s 的峰值）：');
  const step = Math.floor(0.1 * SR);
  const row = [];
  for (let t = 0; t < N; t += step) {
    let p = 0;
    for (let i = t; i < Math.min(N, t + step); i++) p = Math.max(p, Math.abs(mono[i]));
    row.push(p.toFixed(2).replace('0.', '.'));
  }
  console.log('  ' + row.join(' '));
}

// ---------------------------------------------------------------- 频谱图

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, colorType, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), Buffer.from(r)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function colormap(t) {
  // 黑 → 深蓝 → 紫 → 橙 → 白（类似 magma，暗部不会糊成一片）
  const stops = [
    [0.0, 0, 0, 0],
    [0.2, 18, 22, 66],
    [0.42, 74, 32, 110],
    [0.62, 160, 56, 88],
    [0.8, 232, 118, 54],
    [0.92, 253, 186, 106],
    [1.0, 255, 250, 232],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
  }
  return [255, 250, 232];
}

function spectrogram(mono, W, H, loHz, hiHz) {
  const win = 2048;
  const db = new Float32Array(W * H);
  for (let x = 0; x < W; x++) {
    const center = Math.floor(((x + 0.5) / W) * mono.length);
    // 末尾必须夹紧，否则最后几列会重复同一个窗口，画出假的竖直亮条
    const s = clamp(center - win / 2, 0, Math.max(0, mono.length - win));
    const re = new Float64Array(win);
    const im = new Float64Array(win);
    for (let i = 0; i < win; i++) re[i] = (mono[s + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win));
    fft(re, im);
    for (let y = 0; y < H; y++) {
      const frac = 1 - y / (H - 1);            // y=0 在顶部 = 高频
      const f = loHz * Math.pow(hiHz / loHz, frac);
      // 对数频率映射到**单根** bin 会在低频画出假的横向条纹（一根 bin 被重复画很多行），
      // 看起来像梳状滤波。这里在相邻 bin 之间做线性插值。
      const bf = clamp((f * win) / SR, 0, win / 2 - 1.001);
      const b0 = Math.floor(bf);
      const wgt = bf - b0;
      const m0 = re[b0] * re[b0] + im[b0] * im[b0];
      const m1 = re[b0 + 1] * re[b0 + 1] + im[b0 + 1] * im[b0 + 1];
      db[y * W + x] = 10 * Math.log10(m0 * (1 - wgt) + m1 * wgt + 1e-12);
    }
  }
  // 动态范围按实际峰值自动定：固定 -78..-12 dB 时低频一饱和，整张图就是一坨白
  let top = -Infinity;
  for (let i = 0; i < db.length; i++) top = Math.max(top, db[i]);
  const floor = top - 72;
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(W * 3);
    for (let x = 0; x < W; x++) {
      const t = clamp((db[y * W + x] - floor) / (top - floor), 0, 1);
      const [r, g, b] = colormap(t);
      row[x * 3] = r;
      row[x * 3 + 1] = g;
      row[x * 3 + 2] = b;
    }
    rows.push(row);
  }
  return encodePNG(W, H, 2, rows);
}

// ---------------------------------------------------------------- main

mkdirSync(OUT_DIR, { recursive: true });

const t0 = Date.now();
const missile = bakeMissile();
const explosion = bakeExplosion();

const mb = writeWav(`${OUT_DIR}/missile-launch.wav`, [missile.L, missile.R], SR);
const eb = writeWav(`${OUT_DIR}/explosion-air.wav`, [explosion.L, explosion.R], SR);

analyze('missile-launch', [missile.L, missile.R], missile.dur);
analyze('explosion-air', [explosion.L, explosion.R], explosion.dur);

if (process.argv.includes('--spectrogram')) {
  const monoOf = (c) => {
    const n = c[0].length;
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = (c[0][i] + c[1][i]) * 0.5;
    return m;
  };
  mkdirSync('Docs/screenshots', { recursive: true });
  writeFileSync('Docs/screenshots/sfx-missile-spec.png', spectrogram(monoOf([missile.L, missile.R]), 1000, 220, 30, 16000));
  writeFileSync('Docs/screenshots/sfx-explosion-spec.png', spectrogram(monoOf([explosion.L, explosion.R]), 1000, 220, 30, 16000));
  console.log('\n频谱图: Docs/screenshots/sfx-*-spec.png');
}

console.log(`\n写出 ${(mb / 1024).toFixed(0)} KB + ${(eb / 1024).toFixed(0)} KB @ ${SR} Hz 16bit stereo，耗时 ${Date.now() - t0} ms`);
