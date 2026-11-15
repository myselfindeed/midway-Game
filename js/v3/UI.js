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
    this.subtitle = document.getElementById('subtitle');
    this.cdMissile = document.getElementById('cdMissile');
    this.cdShield = document.getElementById('cdShield');
    this.btnMissile = document.getElementById('btnMissile');
    this.btnShield = document.getElementById('btnShield');
    this.btnPause = document.getElementById('btnPause');
    this.rotateGate = document.getElementById('rotateGate');

    this.onStart = null;
    this.onRetry = null;
    this.onPauseToggle = null;

    this._audioCtx = null;
    this._bindHome();
    this._bindPause();
    this._watchOrientation();
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
        if (i >= lines.length) done();
        else render();
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

  setLock(on) {
    this.lockHint.classList.toggle('hidden', !on);
    const reticle = document.getElementById('reticle');
    if (reticle) reticle.classList.toggle('hidden', !on);
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

  playSfx(type) {
    try {
      if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      if (type === 'shoot') {
        o.type = 'square';
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.04, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        o.start(now);
        o.stop(now + 0.06);
      } else if (type === 'explode') {
        o.type = 'sawtooth';
        o.frequency.value = 120;
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        o.start(now);
        o.stop(now + 0.25);
      } else if (type === 'missile') {
        o.type = 'triangle';
        o.frequency.setValueAtTime(240, now);
        o.frequency.exponentialRampToValueAtTime(80, now + 0.35);
        g.gain.setValueAtTime(0.07, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        o.start(now);
        o.stop(now + 0.35);
      } else if (type === 'shield') {
        o.type = 'sine';
        o.frequency.value = 520;
        g.gain.setValueAtTime(0.05, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        o.start(now);
        o.stop(now + 0.2);
      }
    } catch {
      /* ignore audio errors in prototype */
    }
  }
}
