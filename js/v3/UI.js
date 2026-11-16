const BRIEFING = [
  '1942 年 6 月，太平洋上的中途岛将成为战局转折点。',
  '本作以现代空战形式进行作战推演——先发现敌人，才能赢得先机。',
  '特工学员，驾驶战机护航侦察：击落来袭敌机，守住「云上的眼睛」。',
];

const VICTORY_LINE = '历史收束：侦察与预警，让中途岛在暴风雨来临前看见了敌人。';
const DEFEAT_LINE = '任务中断。从检查点重试，继续护航侦察。';
const CP_LINE = '检查点达成：第一波敌机清除。编队状态已保存（登录后可持久化）。';

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
    this.rotateGate = document.getElementById('rotateGate');

    this.onStart = null;
    this.onRetry = null;
    this.onPauseToggle = null;

    this._audioCtx = null;
    this._master = null;
    this._engine = null;
    this.muted = localStorage.getItem('midway-mute') === '1';
    this._syncMuteButton();
    this._bindHome();
    this._bindPause();
    this._bindMute();
    this._watchOrientation();
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
      this._master.connect(this._audioCtx.destination);
    }
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    return this._audioCtx;
  }

  _bindHome() {
    document.getElementById('btnStart').addEventListener('click', () => {
      this.showBriefing(BRIEFING, () => {
        this.hideOverlay();
        this.hud.classList.remove('hidden');
        this.onStart?.();
      });
    });
  }

  _bindPause() {
    this.btnPause.addEventListener('click', () => {
      this.onPauseToggle?.();
    });
  }

  _watchOrientation() {
    const sync = () => {
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      this.rotateGate.classList.toggle('show', portrait);
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
  }

  showBriefing(lines, done) {
    let i = 0;
    const render = () => {
      this.overlay.classList.remove('hidden');
      this.overlay.innerHTML = `
        <div class="panel">
          <p class="eyebrow">任务简报 · 不可跳过</p>
          <p class="meta">旁白 ${i + 1}/${lines.length}</p>
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

  updateMission(kills, target, phase) {
    this.missionText.textContent = `击落敌机 ${kills}/${target}`;
    this.phaseText.textContent =
      phase === 'A' ? '阶段 A · 侦察护航（海面有航母编队）' : '阶段 B · 扩大战果（可锁定舰船）';
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
    const box = frame.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let dx = info.x - cx;
    let dy = info.y - cy;
    if (info.behind) {
      dx = -dx;
      dy = -dy;
    }
    const ang = Math.atan2(dy, dx);
    const reach = Math.max(box.width * 0.72, Math.min(Math.hypot(dx, dy) || 1, Math.min(window.innerWidth, window.innerHeight) * 0.42));
    const ax = Math.min(window.innerWidth - 28, Math.max(28, cx + Math.cos(ang) * reach));
    const ay = Math.min(window.innerHeight - 28, Math.max(28, cy + Math.sin(ang) * reach));
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

  onCheckpoint() {
    this.flashSubtitle(CP_LINE, 3200);
  }

  onVictory() {
    this.hud.classList.add('hidden');
    this.showPanel({
      eyebrow: '任务完成',
      title: '云上的眼睛',
      body: VICTORY_LINE,
      primary: {
        label: '再玩一次',
        onClick: () => {
          this.hideOverlay();
          this.hud.classList.remove('hidden');
          this.onRetry?.('start');
        },
      },
    });
  }

  onDefeat(checkpoint) {
    this.hud.classList.add('hidden');
    this.showPanel({
      eyebrow: '任务失败',
      title: '从检查点重试',
      body: DEFEAT_LINE,
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

  playSfx(type) {
    try {
      const ctx = this._ensureAudio();
      const now = ctx.currentTime;
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
