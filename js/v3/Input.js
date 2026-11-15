export class Input {
  constructor({ joystickEl, stickEl, fireBtn, boostBtn, missileBtn, shieldBtn }) {
    this.axis = { x: 0, y: 0 };
    this.firing = false;
    this.boosting = false;
    this.missilePressed = false;
    this.shieldPressed = false;

    this._joy = joystickEl;
    this._stick = stickEl;
    this._joyActive = false;
    this._joyId = null;
    this._radius = 48;

    this._bindJoystick();
    this._bindHold(fireBtn, (v) => { this.firing = v; fireBtn.classList.toggle('active', v); });
    this._bindHold(boostBtn, (v) => { this.boosting = v; boostBtn.classList.toggle('active', v); });
    this._bindTap(missileBtn, () => { this.missilePressed = true; });
    this._bindTap(shieldBtn, () => { this.shieldPressed = true; });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.firing = true; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boosting = true;
      if (e.code === 'KeyE') this.missilePressed = true;
      if (e.code === 'KeyQ') this.shieldPressed = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.axis.x = -1;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.axis.x = 1;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.axis.y = -1;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.axis.y = 1;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.firing = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.boosting = false;
      if (['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'].includes(e.code)) this.axis.x = 0;
      if (['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'].includes(e.code)) this.axis.y = 0;
    });
  }

  consumeMissile() {
    const v = this.missilePressed;
    this.missilePressed = false;
    return v;
  }

  consumeShield() {
    const v = this.shieldPressed;
    this.shieldPressed = false;
    return v;
  }

  _bindHold(el, set) {
    const on = (e) => { e.preventDefault(); set(true); };
    const off = (e) => { e.preventDefault(); set(false); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }

  _bindTap(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!el.disabled) fn();
    });
  }

  _bindJoystick() {
    const move = (clientX, clientY) => {
      const rect = this._joy.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const max = this._radius;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.axis.x = dx / max;
      this.axis.y = dy / max;
      this._stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };

    const end = () => {
      this._joyActive = false;
      this._joyId = null;
      this.axis.x = 0;
      this.axis.y = 0;
      this._stick.style.transform = 'translate(-50%, -50%)';
    };

    this._joy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._joyActive = true;
      this._joyId = e.pointerId;
      this._joy.setPointerCapture(e.pointerId);
      move(e.clientX, e.clientY);
    });
    this._joy.addEventListener('pointermove', (e) => {
      if (!this._joyActive || e.pointerId !== this._joyId) return;
      move(e.clientX, e.clientY);
    });
    this._joy.addEventListener('pointerup', end);
    this._joy.addEventListener('pointercancel', end);
  }
}
