/* ==========================================================================
   实体：玩家 / 敌机 / 敌舰 / 友军 / 子弹 / 炸弹 / 鱼雷 / 防空炮 / 粒子
   每个实体的 update(g, dt) 由 game.js 的主循环驱动。
   ========================================================================== */
(function (root) {
  'use strict';
  var MG = root.MG, U = MG.U, C = MG.C;

  /* =========================== 粒子 =========================== */
  function Particle(x, y, o) {
    o = o || {};
    this.x = x; this.y = y;
    this.vx = o.vx || 0; this.vy = o.vy || 0;
    this.life = o.life || 0.6; this.max = this.life;
    this.r = o.r || 3; this.grow = o.grow || 0;
    this.kind = o.kind || 'spark';
    this.col = o.col || '#FFE9A8';
    this.drag = o.drag === undefined ? 1.4 : o.drag;
  }
  Particle.prototype.update = function (dt) {
    this.life -= dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vx -= this.vx * this.drag * dt;
    this.vy -= this.vy * this.drag * dt;
    if (this.kind === 'smoke') { this.vy -= 26 * dt; this.r += this.grow * dt; }
    if (this.kind === 'debris') { this.vy += 240 * dt; }
    return this.life > 0;
  };
  Particle.prototype.draw = function (ctx) {
    var a = Math.max(0, this.life / this.max);
    if (this.kind === 'smoke') {
      MG.Art.smoke(ctx, this.x, this.y, this.r, a * 0.55, this.col);
    } else if (this.kind === 'splash') {
      MG.Art.splash(ctx, this.x, this.y, this.r * (1.6 - a * 0.6), a);
    } else if (this.kind === 'debris') {
      ctx.globalAlpha = a;
      ctx.fillStyle = this.col;
      ctx.fillRect(this.x, this.y, 4, 3);
      ctx.globalAlpha = 1;
    } else if (this.kind === 'ring') {
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = this.col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * (2 - a), 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      MG.Art.spark(ctx, this.x, this.y, this.r * a + 0.6, a);
    }
  };
  MG.Particle = Particle;

  /* =========================== 子弹 =========================== */
  function Bullet(x, y, vx, vy, dmg, from, isGun) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.dmg = dmg || 1; this.from = from || 'us';
    this.life = 1.6; this.gun = isGun !== false;
    this.px = x; this.py = y;
  }
  Bullet.prototype.update = function (dt) {
    this.px = this.x; this.py = this.y;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.life -= dt;
    return this.life > 0 && this.y > -40 && this.y < MG.game.H + 40 && this.x > -40 && this.x < MG.game.W + 40;
  };
  Bullet.prototype.draw = function (ctx) {
    if (this.from === 'jp') MG.Art.enemyTracer(ctx, this.px, this.py, this.x, this.y);
    else MG.Art.tracer(ctx, this.px, this.py, this.x, this.y, 1);
  };
  MG.Bullet = Bullet;

  /* =========================== 炸弹 =========================== */
  function Bomb(x, y, vx, vy, owner) {
    this.x = x; this.y = y; this.vx = vx || 0; this.vy = vy || 120;
    this.owner = owner || 'us'; this.dead = false;
    this.targetY = 0; // 由 game 设置：水面或甲板高度
  }
  Bomb.prototype.update = function (dt) {
    this.vy += 620 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    return !this.dead;
  };
  Bomb.prototype.draw = function (ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.atan2(this.vy, this.vx) - Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(6, 26, 5, 8, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#2B3440';
    ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 10, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#8C8674';
    ctx.beginPath(); ctx.ellipse(0, -8, 3, 4, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
  };
  MG.Bomb = Bomb;

  /* =========================== 鱼雷 =========================== */
  function Torp(x, y, vx) {
    this.x = x; this.y = y; this.vx = vx; this.life = 6; this.inWater = false;
    this.trail = [];
  }
  Torp.prototype.update = function (dt) {
    this.life -= dt;
    if (!this.inWater) {
      this.y += 90 * dt; this.x += this.vx * dt;
      if (this.y > MG.game.H * 0.52) this.inWater = true;
    } else {
      this.x += this.vx * dt;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 26) this.trail.shift();
    }
    return this.life > 0;
  };
  Torp.prototype.draw = function (ctx) {
    if (this.inWater) {
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      if (this.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(this.trail[0].x, this.trail[0].y);
        for (var i = 1; i < this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = this.inWater ? 'rgba(210,235,245,.9)' : '#4B5563';
    ctx.beginPath(); ctx.ellipse(this.x, this.y, 8, 3, 0, 0, 6.2832); ctx.fill();
  };
  MG.Torp = Torp;

  /* =========================== 防空炮烟团 =========================== */
  function Flak(x, y) {
    this.x = x; this.y = y; this.t = 0; this.dur = 2.5; this.r = 12;
  }
  Flak.prototype.update = function (dt) {
    this.t += dt;
    if (this.t > this.dur * 0.35 && !this.hit) {
      this.hit = true;
      var g = MG.game;
      if (U.dist(this, g.player) < 52 && g.player.invuln <= 0) g.damagePlayer(1);
    }
    return this.t < this.dur;
  };
  Flak.prototype.draw = function (ctx) {
    var a = 1 - this.t / this.dur;
    MG.Art.flak(ctx, this.x, this.y, this.r * (0.7 + this.t * 0.4), a);
  };
  MG.Flak = Flak;

  /* =========================== 敌机 =========================== */
  function Enemy(type, opts) {
    var def = MG.ENEMY[type] || MG.ENEMY.zero;
    this.type = type;
    this.def = (opts.fire === undefined) ? def : { hp: def.hp, xp: def.xp, r: def.r, speed: def.speed, fire: opts.fire, name: def.name };
    this.dropX = opts.dropX === undefined ? 0 : opts.dropX;
    this.x = opts.x; this.y = opts.y === undefined ? -60 : opts.y;
    this.hp = opts.hp || def.hp;
    this.maxHp = this.hp;
    this.r = def.r * (opts.scale || 1);
    this.scale = opts.scale || 1;
    this.ang = opts.ang || Math.PI;      // 朝下
    this.side = 'jp';
    this.pattern = opts.pattern || 'weave';
    this.phase = U.rand(0, 6.28);
    this.fireT = U.rand(0.8, 2.2);
    this.state = 0;
    this.stationY = opts.stationY || U.rand(140, 320) * (MG.game.H / 720);
    this.baseX = this.x;
    this.lane = opts.lane === undefined ? 0.5 : opts.lane;
    this.speed = def.speed * (opts.speedScale || 1);
    this.escort = !!opts.escort;
    this.dead = false;
    this.hitFlash = 0;
    this.vx = 0; this.vy = 0;
  }

  Enemy.prototype.update = function (g, dt) {
    var p = g.player;
    this.phase += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    switch (this.pattern) {
      case 'weave': {
        if (this.y < this.stationY) { this.y += this.speed * 0.9 * dt; }
        else {
          this.x = this.baseX + Math.sin(this.phase * 1.2) * 120;
          this.y += Math.sin(this.phase * 0.7) * 22 * dt;
          // 缓慢逼近玩家所在水平线
          this.baseX += (p.x - this.baseX) * 0.22 * dt;
        }
        this.ang = Math.PI + Math.sin(this.phase * 1.2) * 0.35;
        break;
      }
      case 'dive': {
        // 朝目标点（岛屿 / 友舰）俯冲
        if (this.tx === undefined) {
          this.tx = (g.island ? g.island.x : this.x) + U.rand(-60, 60);
          this.ty = g.island ? g.island.y : g.H * 0.72;
        }
        var tx = this.tx, tdx = this.tx;
        var ty = this.ty === undefined ? (g.H * 0.72) : this.ty;
        var dx = tx - this.x, dy = ty - this.y;
        var d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        this.x += dx / d * this.speed * dt;
        this.y += dy / d * this.speed * dt;
        this.ang = Math.atan2(dy, dx) - Math.PI / 2;
        if (this.y > ty - 10 && !this.dropped) {
          this.dropped = true;
          g.spawnBomb(this.x, this.y, 0, 60, 'jp', ty + 10);
        }
        break;
      }
      case 'torp': {
        var ttx = g.H * 0.6;
        this.x += this.speed * 0.55 * dt;
        if (this.y < ttx) this.y += this.speed * 0.35 * dt;
        this.ang = Math.PI * 0.5;
        if (this.y >= ttx - 4 && !this.dropped && this.x > this.dropX) {
          this.dropped = true;
          g.spawnTorp(this.x, this.y, 260);
        }
        break;
      }
      case 'chase': {
        // 关卡 3 的"引开"机制：玩家靠近才转为追击玩家，否则去追友军
        var tgt = p;
        var pd = U.dist(p, this);
        if (pd > 300 && g.friendlies && g.friendlies.length) {
          var best = null, bd = 1e9;
          for (var fi = 0; fi < g.friendlies.length; fi++) {
            var ff = g.friendlies[fi];
            if (ff.dead) continue;
            var fd = U.dist(ff, this);
            if (fd < bd) { bd = fd; best = ff; }
          }
          if (best) tgt = best;
          this.tgtRef = (best && tgt !== p) ? tgt : null;
        }
        var ddx = tgt.x - this.x, ddy = tgt.y - this.y;
        var dd = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
        this.x += ddx / dd * this.speed * dt;
        this.y += ddy / dd * this.speed * dt;
        this.ang = Math.atan2(ddy, ddx) - Math.PI / 2;
        this.aggro = (tgt === p);
        break;
      }
      case 'drift': {
        this.y += this.speed * dt;
        this.x += Math.sin(this.phase * 0.6) * 20 * dt;
        this.ang = Math.PI;
        break;
      }
      default: {
        this.y += this.speed * dt;
        break;
      }
    }

    // 开火
    if (this.def.fire > 0) {
      this.fireT -= dt;
      if (this.fireT <= 0 && this.y > 40 && this.y < g.H * 0.86) {
        // 追击友军时朝友军开火，否则朝玩家
        var aim = (this.tgtRef && !this.tgtRef.dead && !this.tgtRef.safe) ? this.tgtRef : p;
        var ad0 = U.dist(aim, this);
        if (ad0 < 460) {
          this.fireT = this.def.fire * U.rand(0.85, 1.35);
          var ax = aim.x - this.x + U.rand(-26, 26);
          var ay = aim.y - this.y + U.rand(-26, 26);
          var ad = Math.max(1, Math.sqrt(ax * ax + ay * ay));
          var sp = 292;
          g.bullets.push(new Bullet(this.x, this.y, ax / ad * sp, ay / ad * sp, 1, 'jp'));
          MG.Audio.shot();
        } else {
          this.fireT = 0.35;
        }
      }
    }

    return this.y < g.H + 90 && this.x > -160 && this.x < g.W + 160;
  };

  Enemy.prototype.hit = function (g, dmg) {
    this.hp -= dmg;
    this.hitFlash = 1;
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  };

  Enemy.prototype.draw = function (ctx) {
    if (this.hitFlash > 0.05) {
      ctx.save();
      ctx.globalAlpha = this.hitFlash * 0.5;
      MG.Art.flash(ctx, this.x, this.y, 26, this.hitFlash * 0.8);
      ctx.restore();
    }
    MG.Art.plane(ctx, {
      x: this.x, y: this.y, ang: this.ang, type: this.type,
      side: 'jp', scale: this.scale, prop: 0.8,
      damaged: this.hp < this.maxHp * 0.5
    });
    // 血条（仅在受过伤后显示）
    if (this.hp < this.maxHp && this.maxHp > 1) {
      var w = 34 * this.scale;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(this.x - w / 2, this.y - 34 * this.scale, w, 4);
      ctx.fillStyle = '#FF9A6B';
      ctx.fillRect(this.x - w / 2, this.y - 34 * this.scale, w * (this.hp / this.maxHp), 4);
    }
  };
  MG.Enemy = Enemy;

  /* =========================== 友军飞机 =========================== */
  function Friendly(opts) {
    this.x = opts.x; this.y = opts.y;
    this.type = opts.type || 'avenger';
    this.hp = opts.hp || 2;
    this.speed = opts.speed || 44;
    this.tx = opts.tx;
    this.ty = opts.ty;
    this.ang = opts.ang || -Math.PI / 2;
    this.name = opts.name || '队友';
    this.safe = false;
    this.dead = false;
    this.progress = 0;
  }
  Friendly.prototype.update = function (g, dt) {
    var dx = this.tx - this.x, dy = this.ty - this.y;
    var d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    if (d < 26) { this.safe = true; return false; }
    this.x += dx / d * this.speed * dt;
    this.y += dy / d * this.speed * dt;
    this.ang = Math.atan2(dy, dx) - Math.PI / 2;
    this.progress = 1 - d / this.totalDist;
    return true;
  };
  Friendly.prototype.draw = function (ctx) {
    MG.Art.plane(ctx, { x: this.x, y: this.y, ang: this.ang, type: this.type, side: 'us', scale: 0.9, prop: 0.7 });
    // 安全进度环
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#48C7D9'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 30, -Math.PI / 2, -Math.PI / 2 + 6.2832 * U.clamp(this.progress, 0, 1));
    ctx.stroke();
    ctx.restore();
  };
  MG.Friendly = Friendly;

  /* =========================== 舰船 =========================== */
  function Ship(type, opts) {
    var def = MG.SHIP[type] || MG.SHIP.destroyer;
    this.type = type;
    this.def = def;
    this.x = opts.x; this.y = opts.y;
    this.w = opts.w || def.w;
    this.h = opts.h || def.h;
    this.hp = opts.hp || def.hp;
    this.maxHp = this.hp;
    this.vx = opts.vx === undefined ? 0 : opts.vx;
    this.armor = def.armor;
    this.dead = false;
    this.t = 0;
    this.hitFlash = 0;
    this.damage = 0;
    this.gunT = U.rand(1.5, 3);
    this.targetable = opts.targetable !== false;
  }
  Ship.prototype.update = function (g, dt) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    if (this.damage < 2 && this.vx) {
      this.x += this.vx * dt;
      if (this.x < this.w * 0.55) { this.x = this.w * 0.55; this.vx = Math.abs(this.vx); }
      if (this.x > g.W - this.w * 0.55) { this.x = g.W - this.w * 0.55; this.vx = -Math.abs(this.vx); }
    }
    // 防空炮
    if (this.damage < 2 && this.hp > 0) {
      this.gunT -= dt;
      if (this.gunT <= 0) {
        this.gunT = U.rand(1.6, 3.0);
        var p = g.player;
        var lead = 0.9;
        var fx = p.x + (p.vx || 0) * lead;
        var fy = p.y + (p.vy || 0) * lead;
        fx += U.rand(-70, 70); fy += U.rand(-50, 50);
        g.flak.push(new Flak(fx, fy));
        MG.Audio.flak();
      }
    }
    this.damage = this.hp > this.maxHp * 0.7 ? 0 : (this.hp > this.maxHp * 0.35 ? 1 : 2);
    return !this.dead;
  };
  Ship.prototype.hit = function (g, dmg) {
    // 航母甲板打不穿：只能用俯冲投弹（§7.5 关卡机制）
    if (this.type === 'carrier' && dmg <= 3) {
      this.hitFlash = 0.6;
      return false;
    }
    var eff = Math.max(1, dmg - this.armor * 0.5);
    this.hp -= eff;
    this.hitFlash = 1;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.damage = 2; return true; }
    return false;
  };
  Ship.prototype.draw = function (ctx) {
    MG.Art.ship(ctx, {
      type: this.type, x: this.x, y: this.y, w: this.w, h: this.h,
      damage: this.damage, t: this.t, speed: this.vx
    });
    if (this.hitFlash > 0.1) {
      ctx.globalAlpha = this.hitFlash * 0.22;
      MG.Art.flash(ctx, this.x, this.y, Math.min(this.w * 0.17, 72), this.hitFlash * 0.45);
      ctx.globalAlpha = 1;
    }
    // 舰名条
    if (this.hp < this.maxHp && this.hp > 0) {
      var bw = Math.min(this.w * 0.8, 240);
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(this.x - bw / 2, this.y - this.h * 0.62, bw, 7);
      ctx.fillStyle = this.type === 'carrier' ? '#FFD34E' : '#FF9A6B';
      ctx.fillRect(this.x - bw / 2, this.y - this.h * 0.62, bw * (this.hp / this.maxHp), 7);
    }
  };
  MG.Ship = Ship;

})(window);
