/* ==========================================================================
   中途岛（成年向 · 竖屏 · 写实）— 核心常量 / 工具 / 音效 / 输入
   所有模块挂在 window.MG 命名空间下，无构建步骤，classic script 直接可用。
   ========================================================================== */
(function (root) {
  'use strict';

  var MG = root.MG = root.MG || {};

  /* ---------------- 常量 ---------------- */
  MG.C = {
    // 写实配色（画风方案 §3）
    col: {
      seaDeep: '#1E4A6B',
      seaMid: '#2A6389',
      seaLight: '#3A7096',
      seaWhite: '#D6E6EE',
      skyTop: '#C6D8E8',
      skyLow: '#E4EEF4',
      skyNoon: '#A8C8DE',
      skyOver: '#9AA8B4',
      cloud: '#EDF1F4',
      cloudDark: '#C8D4DC',
      usLight: '#5A6C7A',   // 美军蓝灰（上表面）
      usDark: '#44515C',    // 蓝灰暗面
      usLow: '#B8C2CA',     // 美军浅灰（下表面）
      usInsignia: '#1B3B6F',
      jpLight: '#9AA68F',   // 零式灰绿
      jpDark: '#6B7A54',    // 舰爆/舰攻深绿
      jpInsignia: '#B23A2B',
      hull: '#8A8F8A',      // 日舰海军灰
      hullDark: '#5E6660',
      deck: '#B08D57',      // 柚木飞行甲板
      deckEdge: '#8A6E3F',
      deckLine: '#E8E2CE',  // 甲板标线
      antifoul: '#5E2B24',  // 水线防污漆
      tracer: '#FFD34E',
      tracerTail: '#FFB84D',
      danger: '#C0392B',
      fire: '#E8762C',
      gold: '#FFD34E',
      hint: '#3FA9C9',
      flak: '#3A3E42',
      smoke: '#3A3E42',
      hullTop: '#5E6673',
      hullBridge: '#3E4753',
      steel: '#2A323C',
      glass: '#2E4A44',
      rust: '#7A5A3A',
      white: '#FFFFFF'
    },

    // 竖屏逻辑分辨率：宽度固定 720，高度随屏幕比例自适应（9:16 ≈ 720×1280）
    VIEW_W: 720,
    VIEW_H_MIN: 1000,
    VIEW_H_MAX: 2200,

    HORIZON: 0.24,          // 地平线在画面高度 24% 处
    PLAY_TOP: 0.30,         // 玩家可活动区域上边界
    PLAY_BOTTOM: 0.92,

    // 成长曲线（5 级，简化）
    LV_XP: [0, 80, 200, 400, 700],
    LV_MAX: 5,

    // 升级解锁
    UNLOCK: {
      2: 'double',      // 双发机枪
      3: 'armor',       // +1 机体强度
      4: 'dash',        // 紧急闪避
      5: 'bombUp'       // 炸弹强化
    }
  };

  /* ---------------- 敌机 / 敌舰 数值 ---------------- */
  MG.ENEMY = {
    zero:   { hp: 6,  xp: 10, r: 24, speed: 138, fire: 1.9, score: 10, name: '零式战斗机' },
    val:    { hp: 8,  xp: 15, r: 26, speed: 108, fire: 2.6, score: 15, name: '九九式舰爆' },
    kate:   { hp: 8,  xp: 15, r: 26, speed: 96,  fire: 2.8, score: 15, name: '九七式舰攻' },
    balloon:{ hp: 1,  xp: 5,  r: 18, speed: 26,  fire: 0,   score: 5,  name: '侦察浮标' }
  };

  MG.SHIP = {
    destroyer: { hp: 20, armor: 2, xp: 50, w: 190, h: 46,  score: 50,  name: '驱逐舰' },
    cruiser:   { hp: 30, armor: 3, xp: 80, w: 240, h: 56,  score: 80,  name: '重巡洋舰' },
    carrier:   { hp: 72, armor: 0, xp: 200, w: 400, h: 92, score: 200, name: '航空母舰' }
  };

  /* ---------------- 玩家机型 ---------------- */
  MG.PLANE = {
    pby:     { hp: 3, gun: 0.20, dmg: 1, spread: 0.016, name: '卡特琳娜' },
    wildcat: { hp: 3, gun: 0.13, dmg: 1, spread: 0.020, name: '野猫' },
    avenger: { hp: 3, gun: 0.17, dmg: 1, spread: 0.022, name: '复仇者' },
    sbd:     { hp: 3, gun: 0.16, dmg: 1, spread: 0.020, name: '无畏式' }
  };

  /* ---------------- 工具 ---------------- */
  var U = MG.U = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randi: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    dist: function (a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); },
    dist2: function (a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },
    easeOut: function (t) { return 1 - (1 - t) * (1 - t); },
    easeInOut: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    approach: function (cur, target, step) {
      if (cur < target) return Math.min(cur + step, target);
      return Math.max(cur - step, target);
    },
    angNorm: function (a) {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    },
    fmt: function (n) { return String(Math.round(n)); }
  };

  /* ---------------- 存档（仅 localStorage，不上传） ---------------- */
  var SAVE_KEY = 'midway_save_v2';
  MG.Save = {
    data: null,
    def: function () {
      return {
        version: 2, unlocked: 1, stars: {}, xp: 0, lvl: 1,
        audioOn: true, sfxOn: true, reduceMotion: false, finished: false
      };
    },
    load: function () {
      try {
        var raw = root.localStorage && root.localStorage.getItem(SAVE_KEY);
        this.data = raw ? JSON.parse(raw) : this.def();
      } catch (e) { this.data = this.def(); }
      if (!this.data || typeof this.data !== 'object') this.data = this.def();
      var d = this.def();
      for (var k in d) if (this.data[k] === undefined) this.data[k] = d[k];
      return this.data;
    },
    save: function () {
      try { root.localStorage && root.localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) {}
    },
    clear: function () { this.data = this.def(); this.save(); }
  };

  /* ---------------- 音效（程序合成，无音频文件） ---------------- */
  var A = MG.Audio = {
    ctx: null, master: null, enabled: true, sfxOn: true,
    init: function () {
      if (this.ctx) return;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    resume: function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    _ok: function () { return this.ctx && this.enabled && this.sfxOn; },
    _noise: function (dur, f0, f1, vol, type) {
      if (!this._ok()) return;
      var c = this.ctx, t = c.currentTime;
      var len = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = c.createBufferSource(); src.buffer = buf;
      var flt = c.createBiquadFilter(); flt.type = type || 'lowpass';
      flt.frequency.setValueAtTime(f0, t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
      var g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    },
    _tone: function (freq, dur, vol, type, slideTo) {
      if (!this._ok()) return;
      var c = this.ctx, t = c.currentTime;
      var o = c.createOscillator(); o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    shot:     function () { this._noise(0.05, 3400, 700, 0.16); this._noise(0.09, 560, 150, 0.13); this._tone(150, 0.05, 0.12, 'square', 90); },
    hit:      function () { this._tone(1700, 0.06, 0.12, 'square', 1000); this._tone(2600, 0.04, 0.06, 'triangle', 1800); },
    explode:  function () { this._noise(0.7, 220, 40, 0.28); this._noise(0.25, 3200, 800, 0.16); this._tone(70, 0.5, 0.20, 'sine', 30); },
    missile:  function () { this._noise(0.7, 500, 2400, 0.16, 'bandpass'); this._tone(120, 0.5, 0.10, 'sawtooth', 320); },
    down:     function () { this._noise(0.8, 1600, 220, 0.14, 'bandpass'); this._tone(600, 0.6, 0.08, 'sine', 120); },
    splash:   function () { this._noise(0.26, 1800, 300, 0.16); this._noise(0.16, 700, 150, 0.10); },
    flak:     function () { this._noise(0.32, 500, 70, 0.15); this._noise(0.14, 2200, 600, 0.09); },
    hurt:     function () { this._tone(140, 0.20, 0.16, 'sine', 60); this._noise(0.18, 900, 200, 0.10); },
    levelup:  function () { var s = this, n = [523, 659, 784, 1046]; n.forEach(function (f, i) { setTimeout(function () { s._tone(f, 0.20, 0.10, 'triangle'); }, i * 90); }); },
    ui:       function () { this._tone(760, 0.06, 0.06, 'triangle'); },
    alarm:    function () { this._tone(420, 0.16, 0.09, 'square', 300); },
    win:      function () { var s = this, n = [523, 659, 784, 1046, 1318]; n.forEach(function (f, i) { setTimeout(function () { s._tone(f, 0.26, 0.09, 'triangle'); }, i * 110); }); },
    dive:     function () { this._noise(1.0, 2400, 500, 0.12, 'bandpass'); }
  };

  /* ---------------- 输入 ---------------- */
  MG.Input = {
    x: 0, y: 0, active: false, id: null,
    _el: null,
    bind: function (el, getScale) {
      this._el = el;
      var self = this;
      function pos(e) {
        var t = (e.touches && e.touches[0]) || e;
        var r = el.getBoundingClientRect();
        var s = getScale ? getScale() : { sx: 1, sy: 1 };
        self.x = (t.clientX - r.left) * s.sx;
        self.y = (t.clientY - r.top) * s.sy;
      }
      el.addEventListener('pointerdown', function (e) {
        if (self.active) return;
        self.active = true; self.id = e.pointerId; pos(e);
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
      }, { passive: true });
      el.addEventListener('pointermove', function (e) {
        if (!self.active || e.pointerId !== self.id) return;
        pos(e);
      }, { passive: true });
      function end(e) {
        if (e.pointerId !== self.id) return;
        self.active = false; self.id = null;
      }
      el.addEventListener('pointerup', end, { passive: true });
      el.addEventListener('pointercancel', end, { passive: true });
      el.addEventListener('pointerleave', function (e) { if (e.pointerId === self.id) { self.active = false; self.id = null; } }, { passive: true });
    },
    stop: function () { this.active = false; this.id = null; }
  };

})(window);
