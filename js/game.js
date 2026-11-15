/* ==========================================================================
   主游戏循环 / 关卡流程 / 目标判定 / 碰撞 / HUD
   ========================================================================== */
(function (root) {
  'use strict';
  var MG = root.MG, U = MG.U, C = MG.C, Art = MG.Art;

  var G = MG.game = {
    state: 'boot',
    W: 720, H: 1280,
    t: 0, dt: 0, timeScale: 1,
    scroll: 1,
    level: null, li: 0,
    player: null,
    bullets: [], enemies: [], ships: [], friendlies: [], bombs: [], torps: [],
    flak: [], particles: [], recons: [],
    waves: [], phase: 'A',
    island: null, allyShip: null,
    progress: 0, shake: 0,
    lives: 3, maxLives: 3,
    retries: 0, livesLost: 0,
    xpGain: 0, kills: 0,
    subQueue: [], subT: 0,
    finishedWaves: 0, totalWaves: 0,
    bombHeld: false, bombArmed: false,
    diveMode: false, diveT: 0, pullT: 0,
    hint: '', hintT: 0
  };

  /* ---------------- 初始化 ---------------- */
  G.init = function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    var self = this;
    root.addEventListener('resize', function () { self.resize(); });
    root.addEventListener('orientationchange', function () { setTimeout(function () { self.resize(); }, 120); });
    MG.Input.bind(canvas, function () { return { sx: self.W / canvas.clientWidth, sy: self.H / canvas.clientHeight }; });
    MG.Save.load();
    MG.Audio.enabled = MG.Save.data.audioOn;
    MG.Audio.sfxOn = MG.Save.data.sfxOn;
    Art.resetLayers(this.W, this.H);
  };

  G.resize = function () {
    var vw = root.innerWidth, vh = root.innerHeight;
    var w = MG.C.VIEW_W;
    var h = Math.round(w * vh / vw);
    h = U.clamp(h, MG.C.VIEW_H_MIN, MG.C.VIEW_H_MAX);
    this.W = w; this.H = h;
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = vw + 'px';
    this.canvas.style.height = vh + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Art.resetLayers(w, h);
    // 竖屏提示：横屏时提示竖屏（与原横屏逻辑相反）
    var rot = document.getElementById('rotate');
    if (rot) rot.classList.toggle('hidden', vh >= vw);
  };

  /* ---------------- 关卡启动 ---------------- */
  G.startLevel = function (idx) {
    this.li = idx;
    var lv = MG.LEVELS[idx];
    this.level = lv;
    this.t = 0; this.timeScale = 1;
    this.bullets = []; this.enemies = []; this.ships = []; this.friendlies = [];
    this.bombs = []; this.torps = []; this.flak = []; this.particles = []; this.recons = [];
    this.subQueue = []; this.subT = 0;
    this.lives = 3; this.livesLost = 0; this.xpGain = 0; this.kills = 0;
    this.phase = 'A';
    this.bombHeld = false; this.diveMode = false; this.diveT = 0; this.pullT = 0;
    this.shake = 0; this.progress = 0;
    this.hintT = 0;
    this.finishedWaves = 0;
    this.sunkCarriers = 0;
    this.reconDone = 0;
    this.escortSaved = 0;
    this.escortLost = 0;
    this._chT = 6;
    this.sweepUsed = false;
    this.wingT = 0;
    this.mercy = false;
    this.phaseT = undefined;

    var save = MG.Save.data;
    var p = this.player = {
      x: this.W * 0.5, y: this.H * 0.74, vx: 0, vy: 0,
      type: lv.plane, ang: 0, bank: 0, prop: 1,
      hp: 3, maxHp: 3 + (save.lvl >= 3 ? 1 : 0),
      invuln: 1.2, fireT: 0, dashCD: 0,
      dead: false
    };
    p.hp = p.maxHp;

    // 目标
    var ob = lv.objective;
    if (ob.type === 'defend' || ob.type === 'mixed') {
      this.island = { x: this.W * (lv.island || 0.5), y: this.H * 0.82, hp: ob.hp, maxHp: ob.hp, name: ob.targetName };
    } else this.island = null;

    if (ob.type === 'scout') {
      this.reconAt = [10, 44, 80];
      this.reconDone = 0;
    }
    if (ob.type === 'escort') {
      this.reconDone = 0;
    }

    // 波次
    this.waves = lv.waves.map(function (w) { return { w: w, done: false }; });
    this.totalWaves = this.waves.length;

    // 友军
    if (ob.type === 'escort') {
      var names = ['小蓝', '小绿', '小黄'];
      for (var i = 0; i < 3; i++) {
        var f = new MG.Friendly({
          x: -60 - i * 70, y: this.H * (0.44 + i * 0.055),
          tx: this.W + 80, ty: this.H * (0.30 + i * 0.03),
          type: 'avenger', hp: 3, speed: 42, name: names[i]
        });
        f.totalDist = Math.abs(f.tx - f.x) + 1;
        this.friendlies.push(f);
      }
      this.escortSaved = 0;
      this.escortLost = 0;
    }

    this.state = 'play';
    MG.UI.enterPlay();
    this.say(lv.radio.start, 3);
  };

  /* ---------------- 关卡重开（保留经验） ---------------- */
  G.retry = function () {
    this.retries++;
    var keepXp = this.xpGain;
    this.startLevel(this.li);
    this.xpGain = keepXp;
    this.livesLost = 0;
    this.say('重新出击！', 2.6);
  };

  /* ---------------- 字幕 ---------------- */
  G.say = function (text, dur) {
    if (!text) return;
    this.subQueue.push({ t: text, d: dur || 2.4 });
  };
  G.updateSubtitle = function (dt) {
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) MG.UI.subtitle('');
      return;
    }
    if (this.subQueue.length) {
      var s = this.subQueue.shift();
      this.subT = s.d;
      MG.UI.subtitle(s.t);
    }
  };

  /* ---------------- 生成物 ---------------- */
  G.addParticles = function (x, y, n, kind, opt) {
    for (var i = 0; i < n; i++) {
      var o = { kind: kind, life: U.rand(0.4, 0.9), r: U.rand(2, 4) };
      o.vx = U.rand(-120, 120); o.vy = U.rand(-120, 120);
      if (kind === 'smoke') { o.life = U.rand(0.7, 1.4); o.r = U.rand(4, 8); o.grow = 14; o.vx = U.rand(-40, 40); o.vy = U.rand(-30, -6); }
      if (kind === 'splash') { o.life = U.rand(0.5, 0.9); o.r = U.rand(6, 12); o.vx = U.rand(-30, 30); o.vy = U.rand(-40, -10); }
      if (kind === 'debris') { o.life = U.rand(0.5, 1.0); o.vx = U.rand(-150, 150); o.vy = U.rand(-180, -60); o.col = '#3E4753'; }
      if (kind === 'ring') { o.life = 0.45; o.r = 10; o.col = '#FFE9A8'; o.vx = 0; o.vy = 0; }
      if (opt) for (var k in opt) o[k] = opt[k];
      this.particles.push(new MG.Particle(x, y, o));
    }
  };

  G.spawnBomb = function (x, y, vx, vy, owner, targetY) {
    var b = new MG.Bomb(x, y, vx, vy, owner);
    b.targetY = targetY;
    this.bombs.push(b);
    return b;
  };

  G.spawnTorp = function (x, y, vx) {
    this.torps.push(new MG.Torp(x, y, vx));
    MG.Audio.splash();
  };

  /* ---------------- 主循环 ---------------- */
  G.update = function (dtRaw) {
    this.dt = dtRaw;
    this.scroll = dtRaw;

    if (this.state !== 'play') { this.t += dtRaw * 0.4; return; }

    var dt = dtRaw * this.timeScale;
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 26);

    this.updateSubtitle(dt);
    this.updatePlayer(dt);
    this.updateWaves(dt);
    this.updateEntities(dt);
    this.updateObjective(dt);
    this.checkCollisions(dt);
    this.updateHUD();
  };

  /* ---------------- 玩家 ---------------- */
  G.updatePlayer = function (dt) {
    var p = this.player, inp = MG.Input;
    var W = this.W, H = this.H;

    // 俯冲状态机（无畏式专用，§7.5）
    if (p.type === 'sbd') {
      if (this.diveMode) {
        this.diveT += dt;
        p.y += (this.H * 0.42) * dt;
        p.x += U.clamp(inp.x - p.x, -300 * dt, 300 * dt) * 0.8;
        if (this.diveT > 4.0) this.endDive();   // 超时自动拉起
        p.ang = 0; p.prop = 1;
      } else if (this.pullT > 0) {
        this.pullT -= dt;
        p.y -= 210 * dt;
        p.y = U.clamp(p.y, H * C.PLAY_TOP, H * C.PLAY_BOTTOM);
      }
    }

    if (!this.diveMode && this.pullT <= 0) {
      var tx = U.clamp(inp.x || W * 0.5, 44, W - 44);
      var ty = U.clamp(inp.y || H * 0.74, H * C.PLAY_TOP, H * C.PLAY_BOTTOM);
      var k = 1 - Math.exp(-14 * dt);
      var nx = U.lerp(p.x, tx, k);
      var ny = U.lerp(p.y, ty, k);
      p.vx = (nx - p.x) / Math.max(dt, 0.0001);
      p.vy = (ny - p.y) / Math.max(dt, 0.0001);
      p.x = nx; p.y = ny;
    }

    // 侧倾
    var targetBank = U.clamp(p.vx / 900, -1, 1);
    p.bank = U.lerp(p.bank, targetBank, 1 - Math.exp(-8 * dt));
    if (!this.diveMode) p.ang = U.clamp(p.vx / 2600, -0.22, 0.22);
    p.prop = 1;

    // 无敌帧
    if (p.invuln > 0) p.invuln -= dt;
    if (p.dashCD > 0) p.dashCD -= dt;

    // 自动开火
    p.fireT -= dt;
    if (p.fireT <= 0 && this.hasTarget()) {
      p.fireT = (MG.PLANE[p.type] || MG.PLANE.wildcat).gun;
      this.shoot();
    }
  };

  /* 自动索敌：不需要瞄准，射程内自动开火（§5.1） */
  G.findTarget = function () {
    var p = this.player, best = null, bd = 620 * 620;
    var i, e, d2;
    for (i = 0; i < this.enemies.length; i++) {
      e = this.enemies[i];
      if (e.dead || e.y < -40) continue;
      d2 = U.dist2(e, p);
      if (d2 < bd) { bd = d2; best = e; }
    }
    for (i = 0; i < this.ships.length; i++) {
      var s = this.ships[i];
      if (s.hp <= 0) continue;
      var dx = Math.abs(s.x - p.x) - s.w * 0.3;
      var dy = Math.abs(s.y - p.y) - s.h * 0.4;
      if (dx < 0) dx = 0; if (dy < 0) dy = 0;
      d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  };

  G.hasTarget = function () { return !!this.findTarget(); };

  G.shoot = function () {
    var p = this.player;
    var lvl = MG.Save.data.lvl;
    var def = MG.PLANE[p.type] || MG.PLANE.wildcat;
    var tgt = this.findTarget();
    var ang = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : -Math.PI / 2;

    // 会聚点：沿射向前方 300px（§9.5 机枪弹道）
    var convX = p.x + Math.cos(ang) * 300;
    var convY = p.y + Math.sin(ang) * 300;
    var streams = lvl >= 2 ? [-15, 15] : [0];

    for (var i = 0; i < streams.length; i++) {
      var off = streams[i];
      var sx = p.x + Math.cos(ang + Math.PI / 2) * off;
      var sy = p.y + Math.sin(ang + Math.PI / 2) * off - 4;
      var ddx = convX - sx, ddy = convY - sy;
      var dd = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
      var sp = 1500;
      var jitter = U.rand(-1, 1) * def.spread * 900;
      this.bullets.push(new MG.Bullet(sx, sy, ddx / dd * sp + jitter, ddy / dd * sp + jitter, 1, 'us'));
    }
    Art.flash(this.ctx, p.x + Math.cos(ang) * 18, p.y + Math.sin(ang) * 18, 16, 0.9);
    MG.Audio.shot();
  };

  /* ---------------- 波次 ---------------- */
  G.updateWaves = function (dt) {
    for (var i = 0; i < this.waves.length; i++) {
      var item = this.waves[i];
      if (item.done) continue;
      var w = item.w;
      if (w.phase && w.phase !== this.phase) continue;
      if (this.t >= w.at) {
        item.done = true;
        this.spawnWave(w);
      }
    }
    this.keepPace();
  };

  /* 空场时提前下一波，避免"打完等 40 秒"的冷场 */
  G.keepPace = function () {
    if (this.t < 8) return;
    if (this.enemies.length || this.ships.length || this.friendlies.length) return;
    var next = null;
    for (var i = 0; i < this.waves.length; i++) {
      var it = this.waves[i];
      if (it.done) continue;
      if (it.w.phase && it.w.phase !== this.phase) continue;
      if (!next || it.w.at < next.w.at) next = it;
    }
    if (next && next.w.at - this.t > 6) next.w.at = this.t + 0.4;
  };

  G.spawnWave = function (w) {
    var W = this.W, H = this.H;
    if (MG.ENEMY[w.type]) {
      var n = w.n || 1;
      for (var i = 0; i < n; i++) {
        var x = n === 1 ? W * U.rand(0.3, 0.7) : W * ((i + 0.5) / n) + U.rand(-30, 30);
        var e = new MG.Enemy(w.type, {
          x: U.clamp(x, 60, W - 60),
          y: w.type === 'balloon' ? U.rand(H * 0.30, H * 0.55) : -70,
          pattern: w.pattern || 'weave',
          fire: w.fire,
          stationY: (w.stationY || 0.32) * H,
          speedScale: w.speedScale || (w.speed ? w.speed / (MG.ENEMY[w.type].speed || 1) : 1),
          scale: w.type === 'zero' ? 1.15 : (w.type === 'kate' ? 1.22 : 1.15),
          dropX: (w.dropX || 0.2) * W
        });
        this.enemies.push(e);
      }
      if (w.type !== 'balloon') MG.Audio.alarm();
    } else if (MG.SHIP[w.type]) {
      var n2 = w.n || 1;
      for (var j = 0; j < n2; j++) {
        var sx, sy;
        if (w.type === 'carrier' && n2 > 1) {
          sx = W * (0.30 + j * 0.20);
          sy = H * (0.38 + j * 0.18);
        } else {
          sx = n2 === 1 ? (w.side === 'right' ? W * 0.76 : W * 0.26) : W * ((j + 0.9) / (n2 + 0.8));
          sy = w.type === 'carrier' ? H * 0.60 : H * 0.68;
        }
        var ship = new MG.Ship(w.type, { x: sx, y: sy, vx: w.type === 'carrier' ? 10 : (w.vx || 16) });
        this.ships.push(ship);
      }
      MG.Audio.alarm();
      this.say(w.type === 'carrier' ? '发现敌航母！' : '发现敌舰！', 2);
    }
  };

  /* ---------------- 实体更新 ---------------- */
  G.updateEntities = function (dt) {
    var i, e;

    for (i = this.bullets.length - 1; i >= 0; i--) {
      if (!this.bullets[i].update(dt)) this.bullets.splice(i, 1);
    }
    for (i = this.particles.length - 1; i >= 0; i--) {
      if (!this.particles[i].update(dt)) this.particles.splice(i, 1);
    }
    for (i = this.flak.length - 1; i >= 0; i--) {
      if (!this.flak[i].update(dt)) this.flak.splice(i, 1);
    }

    for (i = this.enemies.length - 1; i >= 0; i--) {
      e = this.enemies[i];
      if (!e.update(this, dt)) { this.enemies.splice(i, 1); continue; }
      if (e.dead) { this.killEnemy(e); this.enemies.splice(i, 1); }
    }

    for (i = this.ships.length - 1; i >= 0; i--) {
      var s = this.ships[i];
      if (!s.update(this, dt)) { this.ships.splice(i, 1); continue; }
      if (s.dead) { this.killShip(s); this.ships.splice(i, 1); }
    }

    for (i = this.friendlies.length - 1; i >= 0; i--) {
      var f = this.friendlies[i];
      if (f.dead) { this.friendlies.splice(i, 1); continue; }
      if (!f.update(this, dt)) {
        if (f.safe) { this.escortSaved++; this.say(this.level.radio.saved, 2.2); MG.Audio.ui(); }
        this.friendlies.splice(i, 1);
      }
    }

    for (i = this.bombs.length - 1; i >= 0; i--) {
      var b = this.bombs[i];
      b.update(dt);
      if (b.y >= b.targetY) {
        this.bombImpact(b);
        this.bombs.splice(i, 1);
      }
    }

    for (i = this.torps.length - 1; i >= 0; i--) {
      var tp = this.torps[i];
      if (!tp.update(dt)) { this.torps.splice(i, 1); continue; }
      // 鱼雷命中约克城号 / 岛屿
      if (tp.inWater && this.island && Math.abs(tp.x - this.island.x) < 110) {
        this.damageIsland(1);
        this.torps.splice(i, 1);
      }
    }

    // 侦察点
    for (i = this.recons.length - 1; i >= 0; i--) {
      var r = this.recons[i];
      r.t += dt;
      // 停留超过 26 秒自动完成，避免孩子找不到而卡关
      var auto = r.t > 26;
      if (auto || U.dist(r, this.player) < 62) {
        this.recons.splice(i, 1);
        this.reconDone++;
        this.progress = this.reconDone / this.level.objective.points;
        this.addParticles(r.x, r.y, 10, 'ring', { col: '#48C7D9' });
        MG.Audio.ui();
        this.say(['记录第一处观察点。', '海面有情况。', '确认：日军主力舰队！'][Math.min(this.reconDone - 1, 2)], 2.2);
        this.xpGain += 10;
      }
    }
  };

  G.killEnemy = function (e) {
    this.kills++;
    var xp = e.def.xp;
    this.xpGain += xp;
    this.addParticles(e.x, e.y, 8, 'spark');
    this.addParticles(e.x, e.y, 5, 'smoke', { r: 6, grow: 22 });
    this.addParticles(e.x, e.y, 3, 'debris');
    MG.Audio.down();
    MG.Audio.explode();
    // 飞行员跳伞（白色伞，淡出）
    this.addParticles(e.x, e.y, 1, 'smoke', { r: 7, col: 'rgba(255,255,255,.9)', life: 3.5, grow: 0, vy: -22, vx: 0 });
  };

  G.killShip = function (s) {
    this.kills++;
    this.xpGain += s.def.xp;
    this.addParticles(s.x, s.y, 16, 'smoke', { r: 12, grow: 24, life: 1.6 });
    this.addParticles(s.x, s.y, 10, 'spark');
    MG.Audio.explode();
    this.shake = Math.min(10, this.shake + 5);
    if (s.type === 'carrier') {
      this.timeScale = 0.32;
      var self = this;
      setTimeout(function () { self.timeScale = 1; }, 1200);
      if (this.level.objective.type === 'bomb' || this.level.objective.type === 'mixed') {
        this.progress = Math.min(1, (this.sunkCarriers = (this.sunkCarriers || 0) + 1) / 3);
      }
      this.say('敌航母丧失战斗力！', 2.4);
    } else {
      this.progress = Math.min(1, this.progress + 0.1);
    }
  };

  G.bombImpact = function (b) {
    if (b.owner === 'us') {
      // 已由 endDive 结算伤害，这里只做视觉
      this.addParticles(b.x, b.y, 8, 'splash');
      this.addParticles(b.x, b.y, 6, 'spark');
      MG.Audio.splash();
      if (this.hitShipAt) { /* noop */ }
    } else {
      // 敌方炸弹落到岛屿/友舰
      this.addParticles(b.x, b.y, 8, 'splash');
      MG.Audio.splash();
      if (this.island && Math.abs(b.x - this.island.x) < 130) this.damageIsland(1);
    }
  };

  G.damageIsland = function (n) {
    if (!this.island) return;
    this.island.hp -= n;
    this.shake = Math.min(12, this.shake + 6);
    MG.Audio.hurt();
    this.say(this.level.radio.hit || '被击中了！', 2);
    if (this.island.hp <= 0) { this.island.hp = 0; this.fail(); }
  };

  /* ---------------- 俯冲投弹 ---------------- */
  G.beginDive = function () {
    if (this.player.type !== 'sbd' || this.diveMode || this.pullT > 0) return;
    if (this.player.y > this.H * 0.42) {
      this.hintT = 2.2;
      this.hint = '先爬升至画面上方云层';
      this.say('先爬升至云层。', 2);
      return;
    }
    this.diveMode = true;
    this.diveT = 0;
    this.player.invuln = Math.max(this.player.invuln, 0.4);
    this.say(this.level.radio.dive || '俯冲！', 1.6);
    MG.Audio.dive();
  };

  G.endDive = function () {
    if (!this.diveMode) return;
    this.diveMode = false;
    this.pullT = 0.9;
    this.player.invuln = 1.2;
    // 落点 = 俯冲准星位置（§9.5）
    var tx = this.player.x, ty = this.player.y + 120;
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.ships.length; i++) {
      var s = this.ships[i];
      if (s.hp <= 0) continue;
      var d = Math.abs(s.x - tx) + Math.abs(s.y - ty) * 0.6;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      var dx = Math.abs(best.x - tx), dy = Math.abs(best.y - ty);
      var tier = (dx < 60 && dy < 40) ? 3 : ((dx < 130 && dy < 80) ? 2 : 1);
      var base = tier === 3 ? 25 : (tier === 2 ? 15 : 8);
      if (MG.Save.data.lvl >= 5) base = Math.round(base * 1.5);
      this.spawnBomb(tx, ty - 40, 0, 300, 'us', best.y);
      MG.Audio.missile();
      var killed = best.hit(this, base);
      this.addParticles(best.x, best.y, 14, 'spark');
      this.addParticles(best.x, best.y, 8, 'smoke', { r: 8, grow: 20 });
      this.shake = Math.min(10, this.shake + (tier === 3 ? 7 : 4));
      if (tier === 3) { this.say(this.level.radio.perfect || '正中目标！', 2); MG.Audio.explode(); }
      else if (tier === 2) { this.say(this.level.radio.good || '命中了！', 1.8); MG.Audio.hit(); }
      else { this.say(this.level.radio.miss || '偏了！', 1.6); MG.Audio.splash(); }
      this.xpGain += tier * 10;
    } else {
      this.spawnBomb(tx, ty - 40, 0, 300, 'us', ty + 40);
      this.say('未能命中目标', 1.6);
    }
  };

  /* ---------------- 伤害 ---------------- */
  G.damagePlayer = function (n) {
    var p = this.player;
    if (p.invuln > 0 || p.dead) return;
    p.hp -= n;
    p.invuln = 1.1;
    this.shake = Math.min(12, this.shake + 6);
    MG.Audio.hurt();
    this.addParticles(p.x, p.y, 6, 'spark');
    if (p.hp <= 0) this.loseLife();
  };

  G.loseLife = function () {
    this.lives--;
    this.livesLost++;
    this.addParticles(this.player.x, this.player.y, 12, 'smoke', { r: 8, grow: 24 });
    MG.Audio.explode();
    if (this.lives <= 0) {
      this.fail();
    } else {
      var p = this.player;
      p.hp = p.maxHp;
      p.x = this.W * 0.5; p.y = this.H * 0.78;
      p.invuln = 2.2;
      this.diveMode = false; this.pullT = 0;
      this.say('座机修复，继续作战！', 2);
      this.friendlies.forEach(function (f) { /* 友军保留 */ });
    }
  };

  /* ---------------- 碰撞 ---------------- */
  G.checkCollisions = function (dt) {
    var p = this.player, i, j;

    // 我方子弹
    for (i = this.bullets.length - 1; i >= 0; i--) {
      var b = this.bullets[i];
      if (b.from !== 'us') continue;
      var hit = false;

      for (j = 0; j < this.enemies.length; j++) {
        var e = this.enemies[j];
        if (U.dist(b, e) < e.r) {
          var died = e.hit(this, b.dmg);
          this.addParticles(b.x, b.y, 3, 'spark');
          MG.Audio.hit();
          hit = true;
          if (died) { this.killEnemy(e); this.enemies.splice(j, 1); }
          break;
        }
      }
      if (hit) { this.bullets.splice(i, 1); continue; }

      for (j = 0; j < this.ships.length; j++) {
        var s = this.ships[j];
        if (s.hp <= 0) continue;
        if (Math.abs(b.x - s.x) < s.w * 0.5 && Math.abs(b.y - s.y) < s.h * 0.55) {
          var dead = s.hit(this, b.dmg);
          this.addParticles(b.x, b.y, 3, 'spark');
          MG.Audio.hit();
          hit = true;
          if (s.type === 'carrier' && s.hp > 0) this.carrierHint(dt);
          if (dead) { this.killShip(s); this.ships.splice(j, 1); }
          break;
        }
      }
      if (hit) { this.bullets.splice(i, 1); continue; }

      // 打到水面
      if (b.y > this.H * 0.5 && Math.random() < 0.25) {
        this.addParticles(b.x, b.y, 1, 'splash', { r: 4, life: 0.4 });
      }
    }

    // 敌方子弹
    for (i = this.bullets.length - 1; i >= 0; i--) {
      var eb = this.bullets[i];
      if (eb.from !== 'jp') continue;
      if (U.dist(eb, p) < 22 && p.invuln <= 0) {
        this.bullets.splice(i, 1);
        this.damagePlayer(1);
        continue;
      }
      // 打到友军
      for (j = 0; j < this.friendlies.length; j++) {
        var f = this.friendlies[j];
        if (f.dead) continue;
        if (U.dist(eb, f) < 24) {
          this.bullets.splice(i, 1);
          f.hp--;
          this.addParticles(f.x, f.y, 4, 'spark');
          if (f.hp <= 0) {
            f.dead = true;
            this.escortLost = (this.escortLost || 0) + 1;
            this.addParticles(f.x, f.y, 8, 'smoke', { r: 7, grow: 20 });
            MG.Audio.explode();
            this.say('友机被击落！', 2.2);
          }
          break;
        }
      }
    }
  };

  G.carrierHint = function (dt) {
    if (this._chT === undefined) this._chT = 6;
    this._chT -= dt;
    if (this._chT <= 0) {
      this._chT = 16;
      this.say('装甲甲板无法击穿，需俯冲投弹！', 3.2);
    }
  };

  /* ---------------- 目标判定 ---------------- */
  G.updateObjective = function (dt) {
    var ob = this.level.objective;
    var W = this.W, H = this.H;

    // 侦察点生成
    if (ob.type === 'scout' && this.reconAt && this.reconAt.length) {
      if (this.t >= this.reconAt[0]) {
        this.reconAt.shift();
        this.recons.push({ x: U.rand(W * 0.2, W * 0.8), y: U.rand(H * 0.32, H * 0.62), t: 0 });
      }
    }

    if (ob.type === 'scout') {
      this.progress = U.clamp(this.reconDone / ob.points, 0, 1);
      if (this.reconDone >= ob.points) this.win();
      return;
    }

    if (ob.type === 'defend') {
      var cleared = this.waves.filter(function (x) { return x.done; }).length;
      this.progress = U.clamp(cleared / Math.max(1, this.totalWaves), 0, 1);
      var alive = this.enemies.length + this.waves.filter(function (x) { return !x.done; }).length;
      if (alive === 0 && this.t > 20) this.win();
      return;
    }

    if (ob.type === 'escort') {
      this.progress = U.clamp((this.escortSaved || 0) / ob.count, 0, 1);
      var left = this.friendlies.length;
      if (left === 0 && this.t > 8) {
        if ((this.escortSaved || 0) >= 1) this.win();
        else this.fail();
      }
      return;
    }

    if (ob.type === 'bomb') {
      this.progress = U.clamp((this.sunkCarriers || 0) / ob.ships, 0, 1);
      if ((this.sunkCarriers || 0) >= ob.ships) this.win();
      return;
    }

    if (ob.type === 'mixed') {
      if (this.phase === 'A') {
        if (this.island) this.progress = U.clamp(1 - this.island.hp / this.island.maxHp, 0, 0.5) * 1;
        if (this.t > 96) {
          this.phase = 'B';
          this.say(this.level.radio.switch, 3);
          MG.Audio.alarm();
        }
      } else {
        this.progress = 0.5 + U.clamp((this.sunkCarriers || 0), 0, 1) * 0.5;
        if ((this.sunkCarriers || 0) >= 1) this.win();
      }
      return;
    }
  };

  /* ---------------- 结算 ---------------- */
  G.win = function () {
    if (this.state !== 'play') return;
    this.state = 'result';
    MG.Audio.win();
    var stars = 3;
    if (this.livesLost >= 1) stars--;
    if (this.retries > 0) stars--;
    stars = U.clamp(stars, 1, 3);

    var save = MG.Save.data;
    save.stars[this.level.id] = Math.max(save.stars[this.level.id] || 0, stars);
    save.unlocked = Math.max(save.unlocked, Math.min(5, this.level.id + 1));
    G.applyXP(this.xpGain + 100);
    if (this.level.id === 5) save.finished = true;
    MG.Save.save();
    MG.UI.showResult({
      level: this.level, stars: stars,
      xp: this.xpGain + 100, kills: this.kills,
      livesLost: this.livesLost, note: MG.LEVEL_END[this.level.id]
    });
  };

  G.fail = function () {
    if (this.state !== 'play') return;
    this.state = 'fail';
    MG.UI.showFail(this.level, this.li);
  };

  G.applyXP = function (n) {
    var save = MG.Save.data;
    save.xp += n;
    var before = save.lvl;
    while (save.lvl < MG.C.LV_MAX && save.xp >= MG.C.LV_XP[save.lvl]) save.lvl++;
    if (save.lvl > before) {
      MG.Audio.levelup();
      this.newLevel = save.lvl;
    }
  };

  /* ---------------- HUD ---------------- */
  G.updateHUD = function () {
    var p = this.player;
    MG.UI.hud({
      lives: this.lives, maxLives: 3,
      hp: p.hp, maxHp: p.maxHp,
      progress: this.progress,
      xp: MG.Save.data.xp, lvl: MG.Save.data.lvl,
      diveReady: p.type === 'sbd' && this.player.y < this.H * 0.42,
      showBomb: p.type === 'sbd',
      showSkill: MG.Save.data.lvl >= 4,
      skillCD: p.dashCD
    });
  };

  /* ---------------- 渲染 ---------------- */
  G.render = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    if (this.state === 'menu' || this.state === 'boot' || this.state === 'map') {
      Art.menuScene(ctx, W, H, performance.now() / 1000);
      return;
    }

    var lv = this.level || MG.LEVELS[0];
    // 镜头震动
    ctx.save();
    var sh = MG.Save.data.reduceMotion ? this.shake * 0.25 : this.shake;
    if (sh > 0.1) {
      ctx.translate(U.rand(-sh, sh) * 0.5, U.rand(-sh, sh) * 0.5);
    }

    Art.skySea(ctx, W, H, lv.env, (this.state === 'play' ? this.dt : 0.016), this.t, {
      island: this.island ? { x: this.island.x } : null
    });

    // 云层（关卡 4 的"躲进云里"）
    if (lv.plane === 'sbd') this.drawCloudBand(ctx, W, H);

    // 岛屿
    if (this.island) this.drawIsland(ctx);

    // 舰船（按 y 排序，近的盖远的）
    var drawList = this.ships.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < drawList.length; i++) drawList[i].draw(ctx);

    // 鱼雷 / 炸弹
    for (var t = 0; t < this.torps.length; t++) this.torps[t].draw(ctx);
    for (var b = 0; b < this.bombs.length; b++) this.bombs[b].draw(ctx);

    // 友军
    for (var f = 0; f < this.friendlies.length; f++) this.friendlies[f].draw(ctx);

    // 敌机
    for (var e = 0; e < this.enemies.length; e++) this.enemies[e].draw(ctx);

    // 侦察点
    for (var r = 0; r < this.recons.length; r++) this.drawRecon(ctx, this.recons[r]);

    // 玩家
    if (this.player && !this.player.dead && this.state !== 'fail') this.drawPlayer(ctx);
    if (this.diveMode) this.drawReticle(ctx);

    // 子弹
    for (var k = 0; k < this.bullets.length; k++) this.bullets[k].draw(ctx);

    // 防空炮
    for (var fl = 0; fl < this.flak.length; fl++) this.flak[fl].draw(ctx);

    // 粒子
    for (var p2 = 0; p2 < this.particles.length; p2++) this.particles[p2].draw(ctx);

    ctx.restore();

    // 提示
    if (this.hintT > 0 && this.state === 'play') {
      this.hintT -= this.dt;
      ctx.globalAlpha = Math.min(1, this.hintT);
      ctx.fillStyle = 'rgba(9,28,42,.75)';
      var tw = ctx.measureText(this.hint).width;
      ctx.font = '500 22px "PingFang SC", sans-serif';
      tw = ctx.measureText(this.hint).width + 40;
      ctx.fillRect(W / 2 - tw / 2, H * 0.5 - 24, tw, 48);
      ctx.fillStyle = '#FFD34E';
      ctx.textAlign = 'center';
      ctx.fillText(this.hint, W / 2, H * 0.5 + 8);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  };

  G.drawCloudBand = function (ctx, W, H) {
    var baseY = H * 0.20;
    ctx.save();
    for (var i = 0; i < 7; i++) {
      var x = ((i * 250 + this.t * 11) % (W + 420)) - 210;
      var y = baseY + Math.sin(i * 1.7) * 13;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(x, y, 118, 25, 0, 0, 6.2832);
      ctx.ellipse(x + 84, y - 13, 72, 21, 0, 0, 6.2832);
      ctx.ellipse(x - 80, y - 7, 60, 17, 0, 0, 6.2832);
      ctx.ellipse(x + 18, y - 25, 54, 19, 0, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#DCEEF7';
      ctx.beginPath();
      ctx.ellipse(x, y + 14, 132, 9, 0, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  G.drawIsland = function (ctx) {
    var s = this.island;

    // 关卡 5 保护的是约克城号（友方航母），画成舰船而不是岛
    if (this.level.id === 5) {
      var dmg = s.hp > s.maxHp * 0.66 ? 0 : (s.hp > 0 ? 1 : 2);
      Art.ship(ctx, {
        type: 'carrier', x: s.x, y: s.y + 10, w: 400, h: 92,
        damage: dmg, t: this.t, speed: -10
      });
      var bw = 240;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(s.x - bw / 2, s.y - 58, bw, 9);
      ctx.fillStyle = '#48C7D9';
      ctx.fillRect(s.x - bw / 2, s.y - 58, bw * (s.hp / s.maxHp), 9);
      ctx.font = '500 15px "PingFang SC", sans-serif';
      ctx.fillStyle = '#CFE4F2';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, s.x, s.y - 66);
      ctx.textAlign = 'left';
      return;
    }

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#08202F';
    ctx.beginPath(); ctx.ellipse(s.x + 6, s.y + 18, 150, 34, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#CBBD9B';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 132, 30, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#A9BF8D';
    ctx.beginPath(); ctx.ellipse(s.x, s.y - 4, 104, 20, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#7E9668';
    ctx.beginPath(); ctx.ellipse(s.x - 26, s.y - 8, 34, 10, 0, 0, 6.2832); ctx.fill();
    // 血量
    var w = 168, h = 10;
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x - w / 2, s.y - 40, w, h, 5); else ctx.rect(s.x - w / 2, s.y - 40, w, h);
    ctx.fill();
    ctx.fillStyle = '#FF9A6B';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x - w / 2, s.y - 40, w * (s.hp / s.maxHp), h, 5); else ctx.rect(s.x - w / 2, s.y - 40, w * (s.hp / s.maxHp), h);
    ctx.fill();
    ctx.font = '500 14px "PingFang SC", sans-serif';
    ctx.fillStyle = '#CFE4F2';
    ctx.textAlign = 'center';
    ctx.fillText(s.name + '  ' + s.hp + ' / ' + s.maxHp, s.x, s.y - 48);
    ctx.textAlign = 'left';
  };

  G.drawPlayer = function (ctx) {
    var p = this.player;
    if (p.invuln > 0 && Math.floor(this.t * 12) % 2 === 0) { /* 闪烁 */ }
    ctx.save();
    if (p.invuln > 0) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(this.t * 12));
    Art.plane(ctx, {
      x: p.x, y: p.y, ang: p.ang, type: p.type, side: 'us',
      scale: 1.32, bank: p.bank, prop: p.prop, brakes: this.diveMode
    });
    // 冲刺残影
    if (p.dashCD > 0 && p.dashCD > 1.6) {
      ctx.globalAlpha = 0.35;
      Art.plane(ctx, { x: p.x, y: p.y + 40, ang: p.ang, type: p.type, side: 'us', scale: 1.02, prop: 0.5, shadow: false });
    }
    ctx.restore();
  };

  G.drawRecon = function (ctx, r) {
    var pulse = 1 + Math.sin(r.t * 4) * 0.08;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = '#48C7D9';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.arc(0, 0, 52, r.t * 0.8, r.t * 0.8 + 6.2832); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(72,199,217,.18)';
    ctx.beginPath(); ctx.arc(0, 0, 52, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#48C7D9';
    ctx.fillRect(-13, -8, 26, 16);
    ctx.fillStyle = '#0C2B42';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, 6.2832); ctx.fill();
    ctx.restore();
  };

  G.drawReticle = function (ctx) {
    var p = this.player;
    var tx = p.x, ty = p.y + 120;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,211,78,.95)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(tx, ty, 40, 0, 6.2832); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx - 56, ty); ctx.lineTo(tx - 16, ty);
    ctx.moveTo(tx + 16, ty); ctx.lineTo(tx + 56, ty);
    ctx.moveTo(tx, ty - 56); ctx.lineTo(tx, ty - 16);
    ctx.moveTo(tx, ty + 16); ctx.lineTo(tx, ty + 56);
    ctx.stroke();
    ctx.restore();
  };

})(window);
