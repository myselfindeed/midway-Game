import { LEVELS, nextPlayable } from './levels.js';

const PROGRESS_KEY = 'midway-progress';

export class UI {
  constructor() {
    this.overlay = document.getElementById('overlay');
    this.hud = document.getElementById('hud');
    this.hpFill = document.getElementById('hpFill');
    this.missionText = document.getElementById('missionText');
    this.phaseText = document.getElementById('phaseText');
    this.lockHint = document.getElementById('lockHint');
    this.aimFrame = document.getElementById('aimFrame');
    this.aimDir = document.getElementById('aimDir');
    this.subtitle = document.getElementById('subtitle');
    this.cdMissile = document.getElementById('cdMissile');
    this.cdShield = document.getElementById('cdShield');
    this.btnMissile = document.getElementById('btnMissile');
    this.btnFire = document.getElementById('btnFire');
    this.btnShield = document.getElementById('btnShield');
    this.btnPause = document.getElementById('btnPause');
    this.btnMute = document.getElementById('btnMute');
    this.canvas = document.getElementById('game');

    this.onStart = null;
    this.onRetry = null;
    this.onPauseToggle = null;
    this.onSelectLevel = null;
    this.currentLevel = LEVELS[0];
    this._missionMain = null;
    this._missionSub = null;

    this._audioCtx = null;
    this._master = null;
    this._engine = null;
    this.muted = localStorage.getItem('midway-mute') === '1';
    this._syncMuteButton();
    this._bindHome();
    this._bindPause();
    this._bindMute();
  }

  _bindMute() {
    if (!this.btnMute) return;
    this.btnMute.addEventListener('click', () => {
      this.muted = !this.muted;
      localStorage.setItem('midway-mute', this.muted ? '1' : '0');
      this._ensureAudio();
      this._master.gain.value = this.muted ? 0 : 1;
      this._syncMuteButton();
    });
  }

  _syncMuteButton() {
    if (!this.btnMute) return;
    this.btnMute.textContent = this.muted ? '静音' : '声音';
    this.btnMute.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
    this.btnMute.setAttribute('aria-label', this.muted ? '打开声音' : '关闭声音');
  }

  _ensureAudio() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this._audioCtx.createGain();
      this._master.gain.value = this.muted ? 0 : 1;
      // 总线限幅：同屏可能有三四发爆炸重叠，不压一下会直接爆音（数字削波会很刺）
      const limiter = this._audioCtx.createDynamicsCompressor();
      limiter.threshold.value = -9;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.18;
      this._master.connect(limiter);
      limiter.connect(this._audioCtx.destination);
      this._loadSfx();
    }
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    return this._audioCtx;
  }

  /**
   * 载入离线烘焙的音效。合成器做不出"真实"，只能靠录音级的采样；
   * 但没有可商用授权的录音，所以这些 WAV 是自己逐采样合成的
   * （见 tools/bake-sfx.mjs）。载入失败时 playSfx 会退回旧的实时合成。
   */
  _loadSfx() {
    if (this._sfxLoading) return;
    this._sfxLoading = true;
    const files = {
      missile: 'assets/audio/missile-launch.wav',
      explode: 'assets/audio/explosion-air.wav',
    };
    for (const [key, url] of Object.entries(files)) {
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => this._audioCtx.decodeAudioData(buf))
        .then((decoded) => {
          this._sfx = this._sfx || {};
          this._sfx[key] = decoded;
        })
        .catch(() => {
          /* 静默降级到合成音 */
        });
    }
  }

  /**
   * 播放一段烘焙好的采样。
   * pan 由 Game 按目标相对相机的左右位置算出来（-1 左 / 1 右），
   * gain 按距离衰减；rate 略随机化，避免连续两次发射听起来是同一段录音。
   */
  _playSample(buffer, { gain = 1, pan = 0, rate = 1 } = {}) {
    const ctx = this._audioCtx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g);
    if (p) {
      g.connect(p);
      p.connect(this._master);
    } else {
      g.connect(this._master);
    }
    src.start(now);
    if (!this._voices) this._voices = new Set();
    this._voices.add(src);
    src.onended = () => this._voices.delete(src);
    return src;
  }

  _bindHome() {
    const btn = document.getElementById('btnStart');
    if (!btn) return;
    btn.addEventListener('click', () => this.showLevelSelect());
  }

  /** 已解锁到第几关：本地存档 + ?debug 全开（方便调试/截图） */
  _unlockedMax() {
    if (new URLSearchParams(location.search).has('debug')) return LEVELS.length;
    let saved = 1;
    try {
      saved = Number(localStorage.getItem(PROGRESS_KEY)) || 1;
    } catch {
      saved = 1;
    }
    return Math.min(LEVELS.length, Math.max(1, saved));
  }

  _saveProgress(clearedId) {
    try {
      const next = Math.min(LEVELS.length, Math.max(this._unlockedMax(), clearedId + 1));
      localStorage.setItem(PROGRESS_KEY, String(next));
    } catch {
      /* 本地存档不可用时只影响解锁提示，不影响当前这局 */
    }
  }

  showLevelSelect() {
    const unlocked = this._unlockedMax();
    const items = LEVELS.map((l) => {
      const locked = !l.playable || l.id > unlocked;
      const tag = !l.playable ? l.note || '即将开放' : l.id > unlocked ? '未解锁' : '可进入';
      return `
        <button class="level-item${locked ? ' locked' : ''}" data-level="${l.id}" type="button"${locked ? ' disabled' : ''}>
          <span class="level-no">${String(l.id).padStart(2, '0')}</span>
          <span class="level-text"><b>${l.title}</b><em>${l.subtitle}</em></span>
          <span class="level-tag">${tag}</span>
        </button>`;
    }).join('');
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="panel">
        <p class="eyebrow">作战推演 · DEMO</p>
        <h1>选择关卡</h1>
        <div class="level-list">${items}</div>
        <p class="hint">通关后解锁下一关 · 进度仅保存在本机浏览器<br>左手摇杆转向 · 右手按住射击 / 加速 · E 导弹 · Q 护盾</p>
      </div>`;
    this.overlay.querySelectorAll('.level-item:not(.locked)').forEach((el) => {
      el.addEventListener('click', () => {
        const level = LEVELS.find((l) => l.id === Number(el.dataset.level));
        if (!level) return;
        this.showBriefing(level, () => this.beginLevel(level.id));
      });
    });
  }

  beginLevel(id) {
    const level = LEVELS.find((l) => l.id === id) || LEVELS[0];
    this.currentLevel = level;
    this.hideOverlay();
    this.hud.classList.remove('hidden');
    this.setMission('', '', true);
    this.onSelectLevel?.(id);
  }

  _bindPause() {
    this.btnPause.addEventListener('click', () => {
      this.onPauseToggle?.();
    });
  }

  showBriefing(level, done) {
    const lines = level.briefing;
    let i = 0;
    const render = () => {
      this.overlay.classList.remove('hidden');
      this.overlay.innerHTML = `
        <div class="panel">
          <p class="eyebrow">第 ${level.id} 关 · ${level.title} · 简报 ${i + 1}/${lines.length}</p>
          <div class="narration-line">${lines[i]}</div>
          <button id="btnNext" class="btn-primary" type="button">${i < lines.length - 1 ? '继续' : '进入战斗'}</button>
        </div>`;
      document.getElementById('btnNext').addEventListener('click', () => {
        i += 1;
        if (i >= lines.length) {
          this._ensureAudio();
          done();
        } else render();
      });
    };
    render();
  }

  hideOverlay() {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }

  showPanel({ eyebrow, title, body, primary, secondary }) {
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="panel">
        <p class="eyebrow">${eyebrow || ''}</p>
        <h1>${title || ''}</h1>
        <div class="narration-line">${body || ''}</div>
        <button id="btnPrimary" class="btn-primary" type="button">${primary.label}</button>
        ${secondary ? `<p class="hint"><button id="btnSecondary" class="btn-primary" type="button" style="margin-top:10px;background:#234;">${secondary.label}</button></p>` : ''}
      </div>`;
    document.getElementById('btnPrimary').addEventListener('click', primary.onClick);
    if (secondary) {
      document.getElementById('btnSecondary').addEventListener('click', secondary.onClick);
    }
  }

  updateHp(hp, max) {
    const r = Math.max(0, Math.min(1, hp / max));
    this.hpFill.style.transform = `scaleX(${r})`;
  }

  /**
   * 任务栏两行文案由 Game 决定（每关目标不同），这里只做去重写入：
   * 编队装甲每次挨弹都会变，但每秒几十次 textContent 赋值会一直触发重排。
   */
  setMission(main, sub, force = false) {
    if (!force && main === this._missionMain && sub === this._missionSub) return;
    this._missionMain = main;
    this._missionSub = sub;
    this.missionText.textContent = main;
    this.phaseText.textContent = sub;
  }

  updateFlight(speed, altitude, elapsed) {
    const timeEl = document.getElementById('flightTime');
    const speedEl = document.getElementById('speedReadout');
    const altEl = document.getElementById('altReadout');
    if (timeEl) {
      const s = Math.floor(elapsed);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      timeEl.textContent = `${mm}:${ss}`;
    }
    if (speedEl) speedEl.textContent = String(Math.round(speed * 22));
    if (altEl) altEl.textContent = String(Math.round((altitude + 18) * 90));
  }

  setAim(info) {
    const frame = this.aimFrame;
    const dir = this.aimDir;
    if (!frame || !dir) return;
    frame.classList.remove('tracking', 'aimed');
    if (Number.isFinite(info.frameX) && Number.isFinite(info.frameY)) {
      frame.style.left = `${info.frameX}px`;
      frame.style.top = `${info.frameY}px`;
      this.lockHint.style.left = `${info.frameX}px`;
      this.lockHint.style.top = `${info.frameY - 58}px`;
    }
    const aimed = info.state === 'aimed';
    this.lockHint.classList.toggle('hidden', !aimed);
    this.btnMissile.classList.toggle('ready', aimed && !this.btnMissile.disabled);
    if (info.state !== 'track') {
      dir.classList.add('hidden');
      return;
    }
    frame.classList.add('tracking');
    // 用游戏画面坐标系（canvas 布局尺寸），竖屏锁定横放时不能再依赖
    // getBoundingClientRect / innerWidth（那是旋转后的视口坐标，会错位）。
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    // frame 以 (frameX, frameY) 为中心（CSS translate(-50%,-50%)），即画面里的准星点
    const cx = info.frameX;
    const cy = info.frameY;
    let dx = info.x - cx;
    let dy = info.y - cy;
    if (info.behind) {
      dx = -dx;
      dy = -dy;
    }
    const ang = Math.atan2(dy, dx);
    const fw = frame.offsetWidth || 96;
    const reach = Math.max(fw * 0.72, Math.min(Math.hypot(dx, dy) || 1, Math.min(cw, ch) * 0.42));
    const ax = Math.min(cw - 28, Math.max(28, cx + Math.cos(ang) * reach));
    const ay = Math.min(ch - 28, Math.max(28, cy + Math.sin(ang) * reach));
    dir.classList.remove('hidden');
    dir.style.left = `${ax}px`;
    dir.style.top = `${ay}px`;
    dir.style.transform = 'translate(-50%, -50%)';
    dir.style.setProperty('--ang', `${ang}rad`);
  }

  updateCds(mCd, sCd, mMax, sMax) {
    this.cdMissile.textContent = mCd > 0 ? `导弹冷却 ${mCd.toFixed(1)}s` : '导弹就绪';
    this.cdShield.textContent = sCd > 0 ? `护盾冷却 ${sCd.toFixed(1)}s` : '护盾就绪';
  }

  setSkillDisabled(missile, shield) {
    this.btnMissile.disabled = missile;
    this.btnShield.disabled = shield;
    this.btnMissile.classList.toggle('cooling', missile);
    this.btnShield.classList.toggle('cooling', shield);
  }

  flashSubtitle(text, ms = 2800) {
    this.subtitle.textContent = text;
    this.subtitle.classList.remove('hidden');
    clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => this.subtitle.classList.add('hidden'), ms);
  }

  onCheckpoint(line) {
    this.flashSubtitle(line || '检查点达成：编队状态已保存。', 3200);
  }

  onVictory(level) {
    this.currentLevel = level;
    this.hud.classList.add('hidden');
    this._saveProgress(level.id);
    const next = nextPlayable(level);
    const demoEnd = next ? '' : '<br><br>全部关卡已通关，可返回选关重玩任意一关。';
    this.showPanel({
      eyebrow: '任务完成',
      title: level.victory.title,
      body: `${level.victory.body}${demoEnd}`,
      primary: next
        ? {
            label: `进入第 ${next.id} 关 · ${next.title}`,
            onClick: () => this.showBriefing(next, () => this.beginLevel(next.id)),
          }
        : { label: '返回关卡选择', onClick: () => this.showLevelSelect() },
      secondary: next ? { label: '返回关卡选择', onClick: () => this.showLevelSelect() } : null,
    });
  }

  onDefeat(checkpoint, reason = 'player', level = this.currentLevel) {
    this.hud.classList.add('hidden');
    const body = level?.defeat?.[reason] || level?.defeat?.player || '任务中断，从检查点重试。';
    this.showPanel({
      eyebrow: reason === 'base' ? '编队覆没' : '任务失败',
      title: '从检查点重试',
      body,
      primary: {
        label: checkpoint === 'cp1' ? '从检查点重试' : '整关重来',
        onClick: () => {
          this.hideOverlay();
          this.hud.classList.remove('hidden');
          this.onRetry?.(checkpoint);
        },
      },
      secondary: {
        label: '整关重来',
        onClick: () => {
          this.hideOverlay();
          this.hud.classList.remove('hidden');
          this.onRetry?.('start');
        },
      },
    });
  }

  showPaused(resume, checkpoint = 'start') {
    this.showPanel({
      eyebrow: '暂停',
      title: '任务暂缓',
      body: '横屏继续作战。可从检查点重试或返回。',
      primary: {
        label: '继续',
        onClick: () => {
          this.hideOverlay();
          this.hud.classList.remove('hidden');
          resume();
        },
      },
      secondary: {
        label: '从检查点重试',
        onClick: () => {
          this.hideOverlay();
          this.hud.classList.remove('hidden');
          this.onRetry?.(checkpoint);
        },
      },
    });
  }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const ctx = this._audioCtx;
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      data[i] = last;
    }
    this._noise = buf;
    return buf;
  }

  _burst(now, { duration, gain, filter, freq, q, endFreq }) {
    const ctx = this._audioCtx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = filter;
    bp.frequency.setValueAtTime(freq, now);
    if (endFreq) bp.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(bp);
    bp.connect(g);
    g.connect(this._master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  setEngine(on, speed = 28) {
    try {
      this._ensureAudio();
      if (!this._engine) {
        const ctx = this._audioCtx;
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer();
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 240;
        filter.Q.value = 0.65;
        const tone = ctx.createOscillator();
        tone.type = 'sawtooth';
        tone.frequency.value = 70;
        const toneGain = ctx.createGain();
        toneGain.gain.value = 0.04;
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        src.connect(filter);
        filter.connect(gain);
        tone.connect(toneGain);
        toneGain.connect(gain);
        gain.connect(this._master);
        src.start();
        tone.start();
        this._engine = { filter, tone, gain };
      }
      const now = this._audioCtx.currentTime;
      const ratio = on ? Math.max(0.4, Math.min(1, speed / 48)) : 0;
      const level = on ? 0.04 + ratio * 0.06 : 0.0001;
      this._engine.gain.gain.setTargetAtTime(level, now, 0.15);
      this._engine.filter.frequency.setTargetAtTime(150 + ratio * 620, now, 0.12);
      this._engine.tone.frequency.setTargetAtTime(48 + ratio * 95, now, 0.12);
    } catch {
      /* ignore audio errors in prototype */
    }
  }

  playSfx(type, opts = {}) {
    try {
      const ctx = this._ensureAudio();
      const now = ctx.currentTime;

      // 优先用烘焙采样；没加载完或加载失败就退回下面的实时合成
      if (type === 'missile' && this._sfx?.missile) {
        this._playSample(this._sfx.missile, {
          gain: 1.0 * (opts.gain ?? 1),
          pan: opts.pan ?? 0,
          // 变调范围收窄到 ±2%：再大就会和试听时选定的那版听起来不是同一个声音。
          // 留一点点随机只是为了连续发射时不至于完全复读。
          rate: (opts.rate ?? 1) * (0.98 + Math.random() * 0.04),
        });
        return;
      }
      if (type === 'explode' && this._sfx?.explode) {
        // 同屏多架同时被击落时叠起来会变成噪音墙，按 0.35 s 内的重叠数压低
        if (!this._explodeLog) this._explodeLog = [];
        this._explodeLog = this._explodeLog.filter((t) => now - t < 0.35);
        const overlap = this._explodeLog.length;
        this._explodeLog.push(now);
        const duck = 1 / (1 + overlap * 0.5);
        this._playSample(this._sfx.explode, {
          gain: 0.60 * (opts.gain ?? 1) * duck,
          pan: opts.pan ?? 0,
          // 和导弹一样收窄到 ±2.5%：这一段是选定的版本，变调太多就不是同一个声音了。
          // 舰船那条路径显式传 rate 0.78，仍然在这个基础上继续下压
          rate: (opts.rate ?? 1) * (0.975 + Math.random() * 0.05),
        });
        return;
      }

      if (type === 'shoot') {
        this._burst(now, { duration: 0.07, gain: 0.42, filter: 'bandpass', freq: 1800, endFreq: 700, q: 0.6 });
        this._burst(now, { duration: 0.045, gain: 0.22, filter: 'highpass', freq: 3200, q: 0.4 });
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(160, now);
        o.frequency.exponentialRampToValueAtTime(55, now + 0.06);
        g.gain.setValueAtTime(0.16, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        o.connect(g);
        g.connect(this._master);
        o.start(now);
        o.stop(now + 0.08);
      } else if (type === 'explode') {
        this._burst(now, { duration: 0.45, gain: 0.55, filter: 'lowpass', freq: 420, endFreq: 80, q: 0.5 });
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(90, now);
        o.frequency.exponentialRampToValueAtTime(32, now + 0.4);
        g.gain.setValueAtTime(0.12, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        o.connect(g);
        g.connect(this._master);
        o.start(now);
        o.stop(now + 0.45);
      } else if (type === 'missile') {
        this._burst(now, { duration: 0.7, gain: 0.38, filter: 'bandpass', freq: 900, endFreq: 140, q: 0.8 });
        this._burst(now, { duration: 0.55, gain: 0.2, filter: 'lowpass', freq: 500, endFreq: 90, q: 0.4 });
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(620, now);
        o.frequency.exponentialRampToValueAtTime(110, now + 0.65);
        g.gain.setValueAtTime(0.05, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
        o.connect(g);
        g.connect(this._master);
        o.start(now);
        o.stop(now + 0.7);
      } else if (type === 'hit') {
        this._burst(now, { duration: 0.16, gain: 0.4, filter: 'bandpass', freq: 900, endFreq: 220, q: 0.8 });
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(210, now);
        o.frequency.exponentialRampToValueAtTime(70, now + 0.14);
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        o.connect(g);
        g.connect(this._master);
        o.start(now);
        o.stop(now + 0.17);
      } else if (type === 'shield') {
        const dur = 2;
        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer();
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1800;
        hp.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        src.connect(hp);
        hp.connect(g);
        g.connect(this._master);
        src.start(now);
        src.stop(now + dur);
        for (let i = 0; i < 18; i++) {
          const t = now + i * (dur / 18);
          g.gain.setValueAtTime(0.015 + Math.random() * 0.07, t);
        }
        g.gain.setValueAtTime(0.001, now + dur);
        for (let i = 0; i < 6; i++) {
          const t = now + Math.random() * (dur - 0.08);
          const zap = ctx.createOscillator();
          const zg = ctx.createGain();
          zap.type = 'square';
          zap.frequency.setValueAtTime(1400 + Math.random() * 2800, t);
          zg.gain.setValueAtTime(0.045, t);
          zg.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
          zap.connect(zg);
          zg.connect(this._master);
          zap.start(t);
          zap.stop(t + 0.05);
        }
      }
    } catch {
      /* ignore audio errors in prototype */
    }
  }
}
