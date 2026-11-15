/* ==========================================================================
   程序化美术渲染层
   实现 §9.3 的全部视觉规范：地平线透视 / 纵向压缩 / 双色明暗 / 厚白描边 / 落地阴影
   将来若改为 Blender 序列帧，只需替换本文件导出的函数，玩法层无需改动。
   ========================================================================== */
(function (root) {
  'use strict';
  var MG = root.MG, C = MG.C.col, U = MG.U;
  var Art = MG.Art = {};

  /* ------------------------------------------------------------------
     写实载具 sprite（参考图风格，透明背景）
     ------------------------------------------------------------------ */
  var sprites = {};
  function loadSprite(name, src) {
    var img = new Image();
    img.onload = function () { sprites[name] = img; };
    img.src = src;
    sprites[name] = img;
  }
  loadSprite('fighter', 'assets/fighter.png');
  loadSprite('carrier', 'assets/carrier.png');
  loadSprite('destroyer', 'assets/destroyer.png');

  function spriteReady(name) {
    var s = sprites[name];
    return s && s.complete && s.naturalWidth > 0;
  }

  /* 写实飞机 sprite（机头朝上，随 o.ang 转向） */
  Art.spritePlane = function (ctx, o, img) {
    var scale = o.scale || 1;
    var ratio = img.naturalWidth / img.naturalHeight;
    var w = 96 * scale, h = w / ratio;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.shadow !== false) {
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#0A1A26';
      ctx.translate(11, 16);
      ctx.rotate(o.ang || 0);
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.32, h * 0.42, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(o.ang || 0);
    var bank = o.bank || 0;
    var s = scale * (1 - Math.abs(bank) * 0.22);
    ctx.scale(s, scale);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  /* 写实舰船 sprite（已预处理为横向素材，可加旋转校正角度） */
  Art.spriteShip = function (ctx, o, img, rot) {
    var w = o.w || 190;
    var ratio = img.naturalWidth / img.naturalHeight;
    var dispW = w, dispH = w / ratio;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (rot) ctx.rotate(rot);
    ctx.scale(1, 0.7);
    ctx.drawImage(img, -dispW / 2, -dispH / 2, dispW, dispH);
    ctx.restore();
  };

  /* ------------------------------------------------------------------
     海面与天空
     ------------------------------------------------------------------ */
  var waves = null, clouds = null;

  function initLayers(W, H) {
    waves = [];
    for (var i = 0; i < 90; i++) {
      waves.push({ x: Math.random(), wy: Math.pow(Math.random(), 0.8), len: U.rand(10, 46), w: U.rand(1, 3), a: U.rand(0.18, 0.5) });
    }
    clouds = [];
    for (var j = 0; j < 10; j++) {
      clouds.push({ x: Math.random(), y: U.rand(0.28, 0.88), s: U.rand(0.5, 1.15), a: U.rand(0.3, 0.62), v: U.rand(0.004, 0.012) });
    }
  }

  Art.resetLayers = function (W, H) { initLayers(W, H); };

  Art.skySea = function (ctx, W, H, env, scroll, t, opts) {
    if (!waves) initLayers(W, H);
    env = env || {};
    var hz = Math.round(H * MG.C.HORIZON);
    var skyTop = env.skyTop || C.skyTop;
    var skyLow = env.skyLow || C.skyLow;

    // 天空
    var g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, skyTop);
    g.addColorStop(1, skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hz + 1);

    // 太阳/雾气
    if (env.sun !== false) {
      var sx = (env.sunX || 0.72) * W, sy = hz - 6;
      var sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 160);
      sg.addColorStop(0, env.sunCol || 'rgba(255,246,214,.55)');
      sg.addColorStop(1, 'rgba(255,246,214,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 170, sy - 170, 340, 340);
    }

    // 云（视差 0.4×）
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x -= c.v * 0.016;
      if (c.x < -0.2) { c.x = 1.2; c.y = U.rand(0.28, 0.88); }
      var cx = c.x * W, cy = c.y * hz, s = c.s * (W / 1280);
      ctx.globalAlpha = c.a;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 78 * s, 13 * s, 0, 0, 6.2832);
      ctx.ellipse(cx + 44 * s, cy - 7 * s, 44 * s, 12 * s, 0, 0, 6.2832);
      ctx.ellipse(cx - 44 * s, cy - 4 * s, 38 * s, 9 * s, 0, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 海
    var seaTop = env.seaTop || C.seaLight;
    var seaBot = env.seaBot || C.seaDeep;
    var gg = ctx.createLinearGradient(0, hz, 0, H);
    gg.addColorStop(0, seaTop);
    gg.addColorStop(0.45, env.seaMid || C.seaMid);
    gg.addColorStop(1, seaBot);
    ctx.fillStyle = gg;
    ctx.fillRect(0, hz, W, H - hz);

    // 地平线
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, hz - 1, W, 2);

    // 透视波纹：越靠近底部越快、越长、越粗
    var span = H - hz;
    for (var k = 0; k < waves.length; k++) {
      var wv = waves[k];
      wv.wy += (0.10 + wv.wy * 0.55) * scroll;
      if (wv.wy > 1.02) { wv.wy = Math.random() * 0.06; wv.x = Math.random(); }
      var p = wv.wy;
      var y = hz + p * span;
      var len = wv.len * (1 + p * 3.4) * (W / 1280);
      var th = wv.w * (0.6 + p * 2.2);
      ctx.globalAlpha = wv.a * (0.28 + p * 0.72);
      ctx.strokeStyle = p > 0.5 ? C.seaLight : '#2E6C8F';
      ctx.lineWidth = th;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wv.x * W, y);
      ctx.lineTo(wv.x * W + len, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 地平线雾气（增强纵深，不做无用剪影）
    var hg = ctx.createLinearGradient(0, hz - 14, 0, hz + 26);
    hg.addColorStop(0, 'rgba(255,255,255,.18)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, hz - 14, W, 40);
  };

  /* ------------------------------------------------------------------
     飞机
     type: pby | wildcat | zero | val | kate | sbd | avenger
     ------------------------------------------------------------------ */
  var SPEC = {
    pby:     { L: 66, W: 15, span: 116, wy: -3, chord: 17, tip: 'round', twin: true, float: true, fin: 1.15 },
    wildcat: { L: 52, W: 16, span: 84,  wy: 0,  chord: 23, tip: 'round', stub: true, fin: 0.9 },
    zero:    { L: 58, W: 12, span: 78,  wy: 1,  chord: 17, tip: 'ellipse', fin: 0.85 },
    val:     { L: 55, W: 13, span: 80,  wy: 0,  chord: 19, tip: 'ellipse', gear: true, fin: 0.9 },
    kate:    { L: 64, W: 12, span: 86,  wy: 0,  chord: 18, tip: 'ellipse', torp: true, fin: 1.0 },
    sbd:     { L: 58, W: 14, span: 88,  wy: 0,  chord: 21, tip: 'round', brakes: true, fin: 0.95 },
    avenger: { L: 62, W: 17, span: 92,  wy: 0,  chord: 21, tip: 'round', turret: true, fin: 1.05 }
  };

  function bodyPath(ctx, s) {
    var L = s.L, W = s.W;
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.52);
    ctx.quadraticCurveTo(W * 0.64, -L * 0.33, W * 0.52, -L * 0.02);
    ctx.quadraticCurveTo(W * 0.47, L * 0.26, W * 0.30, L * 0.44);
    ctx.quadraticCurveTo(W * 0.16, L * 0.53, 0, L * 0.53);
    ctx.quadraticCurveTo(-W * 0.16, L * 0.53, -W * 0.30, L * 0.44);
    ctx.quadraticCurveTo(-W * 0.47, L * 0.26, -W * 0.52, -L * 0.02);
    ctx.quadraticCurveTo(-W * 0.64, -L * 0.33, 0, -L * 0.52);
    ctx.closePath();
  }

  function wingPath(ctx, s, side, dy) {
    var h = s.span * 0.5, c = s.chord, y = s.wy + (dy || 0);
    var x0 = s.W * 0.34;
    ctx.beginPath();
    ctx.moveTo(side * x0, y - c * 0.62);
    ctx.lineTo(side * (h - c * 0.12), y - c * 0.34);
    ctx.quadraticCurveTo(side * h, y - c * 0.26, side * h, y + c * 0.08);
    ctx.quadraticCurveTo(side * h, y + c * 0.32, side * (h - c * 0.16), y + c * 0.40);
    ctx.lineTo(side * x0, y + c * 0.62);
    ctx.closePath();
  }

  function tailPath(ctx, s, side) {
    var h = s.span * 0.27, c = s.chord * 0.55, y = s.L * 0.36, x0 = s.W * 0.24;
    ctx.beginPath();
    ctx.moveTo(side * x0, y - c * 0.62);
    ctx.lineTo(side * h, y - c * 0.30);
    ctx.lineTo(side * h, y + c * 0.30);
    ctx.lineTo(side * x0, y + c * 0.62);
    ctx.closePath();
  }

  /* 统一的"写实哑光漆面 + 明暗渐变"绘制流程（左上主光，无卡通白描边） */
  function paintParts(ctx, parts, light, dark, lw) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // 1. 基底填充（主色）
    ctx.fillStyle = light;
    for (var j = 0; j < parts.length; j++) { parts[j].path(); ctx.fill(); }
    // 2. 明暗渐变：左上高光 → 右下暗部，模拟左上 45° 主光
    var g = ctx.createLinearGradient(-46, -62, 46, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.15)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    for (var k = 0; k < parts.length; k++) { if (!parts[k].noShade) { parts[k].path(); ctx.fill(); } }
    // 3. 右侧暗面补色（增强体积感）
    ctx.save();
    ctx.beginPath();
    ctx.rect(6, -200, 200, 400);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = dark;
    for (var m = 0; m < parts.length; m++) { if (!parts[m].noShade) { parts[m].path(); ctx.fill(); } }
    ctx.restore();
    ctx.globalAlpha = 1;
    // 4. 深色细描边（模拟轮廓 AO，替代卡通白描边）
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = lw || 1.5;
    for (var n = 0; n < parts.length; n++) { parts[n].path(); ctx.stroke(); }
  }

  /* 观测气球（关卡 1 的靶子） */
  function balloon(ctx, o) {
    var sc = o.scale || 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(sc, sc);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#06202F';
    ctx.beginPath(); ctx.ellipse(8, 16, 20, 8, 0, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    // 系留索
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(0, 60); ctx.stroke();
    // 球体
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#8A96A0';
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 23, 0, 0, 6.2832); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 23, 0, 0, 6.2832); ctx.clip();
    ctx.fillStyle = '#687580';
    ctx.fillRect(0, -26, 24, 52);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 23, 0, 0, 6.2832); ctx.stroke();
    // 吊篮
    ctx.fillStyle = '#3E4753';
    ctx.fillRect(-7, 22, 14, 11);
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 1.2;
    ctx.strokeRect(-7, 22, 14, 11);
    ctx.restore();
  }

  Art.plane = function (ctx, o) {
    if (o.type === 'balloon') return balloon(ctx, o);
    // 我方野猫战斗机使用写实 sprite
    if (o.type === 'wildcat' && o.side === 'us' && spriteReady('fighter')) {
      return Art.spritePlane(ctx, o, sprites.fighter);
    }
    var s = SPEC[o.type] || SPEC.zero;
    var scale = o.scale || 1;
    ctx.save();
    ctx.translate(o.x, o.y);

    // 落地阴影（写实：更深、更实、偏移更大）
    if (o.shadow !== false) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#0A1A26';
      ctx.translate(12, 18);
      ctx.rotate(o.ang || 0);
      ctx.scale(scale * (1 - 0.04), scale * 0.92);
      bodyPath(ctx, s); ctx.fill();
      wingPath(ctx, s, 1); ctx.fill();
      wingPath(ctx, s, -1); ctx.fill();
      ctx.restore();
    }

    ctx.rotate(o.ang || 0);
    // 倾斜（bank）：横向压缩，模拟侧倾
    var bank = o.bank || 0;
    ctx.scale(scale * (1 - Math.abs(bank) * 0.22), scale);

    var light = o.light || (o.side === 'jp' ? C.jpLight : C.usLight);
    var dark = o.dark || (o.side === 'jp' ? C.jpDark : C.usDark);

    var parts = [];
    parts.push({ path: function () { bodyPath(ctx, s); } });
    parts.push({ path: function () { wingPath(ctx, s, 1); } });
    parts.push({ path: function () { wingPath(ctx, s, -1); } });
    parts.push({ path: function () { tailPath(ctx, s, 1); } });
    parts.push({ path: function () { tailPath(ctx, s, -1); } });

    // 双发（PBY）
    if (s.twin) {
      [-1, 1].forEach(function (sd) {
        parts.push({ path: function () {
          ctx.beginPath();
          ctx.ellipse(sd * s.span * 0.27, s.wy + 2, 7, 15, 0, 0, 6.2832);
        } });
      });
    }
    // 浮筒（PBY）
    if (s.float) {
      [-1, 1].forEach(function (sd) {
        parts.push({ path: function () {
          ctx.beginPath();
          ctx.moveTo(sd * s.span * 0.5, s.wy - 4);
          ctx.lineTo(sd * s.span * 0.66, s.wy + 1);
          ctx.lineTo(sd * s.span * 0.5, s.wy + 9);
          ctx.closePath();
        } });
      });
    }
    // 固定起落架（九九舰爆的最大辨识点）
    if (s.gear) {
      [-1, 1].forEach(function (sd) {
        parts.push({ path: function () {
          ctx.beginPath();
          ctx.rect(sd * s.span * 0.26 - 2.5, s.wy - 12, 5, 16);
        } });
      });
    }
    // 尾翼
    parts.push({ path: function () {
      ctx.beginPath();
      ctx.ellipse(0, s.L * 0.40, s.W * 0.30 * s.fin, s.L * 0.10, 0, 0, 6.2832);
    } });

    paintParts(ctx, parts, light, dark, 8);

    // 面板线（机身上几条淡线，非纯黑）
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s.W * 0.30, -s.L * 0.04); ctx.lineTo(s.W * 0.30, -s.L * 0.04);
    ctx.moveTo(-s.W * 0.26, s.L * 0.18); ctx.lineTo(s.W * 0.26, s.L * 0.18);
    ctx.stroke();

    // 座舱（深绿反光 + 天空反射）
    ctx.fillStyle = C.glass;
    ctx.beginPath();
    ctx.ellipse(0, -s.L * 0.16, s.W * 0.20, s.L * 0.16, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = 'rgba(200,228,240,.5)';
    ctx.beginPath();
    ctx.ellipse(-s.W * 0.04, -s.L * 0.20, s.W * 0.12, s.L * 0.08, 0, 0, 6.2832);
    ctx.fill();

    // 机枪塔（复仇者）
    if (s.turret) {
      ctx.fillStyle = 'rgba(18,42,60,.7)';
      ctx.beginPath(); ctx.arc(0, s.L * 0.24, 7, 0, 6.2832); ctx.fill();
    }
    // 机腹鱼雷（九七舰攻）
    if (s.torp) {
      ctx.fillStyle = '#4B5563';
      ctx.beginPath();
      ctx.ellipse(0, s.L * 0.10, 3.6, s.L * 0.28, 0, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // 俯冲减速板（无畏式的招牌）
    if (s.brakes && o.brakes) {
      ctx.strokeStyle = '#E9E2C8';
      ctx.lineWidth = 2.5;
      for (var b = 0; b < 4; b++) {
        var off = -6 + b * 4.5;
        ctx.beginPath();
        ctx.moveTo(-s.span * 0.36, s.wy + 6 + off * 0.5);
        ctx.lineTo(-s.span * 0.16, s.wy + 10 + off * 0.5);
        ctx.moveTo(s.span * 0.36, s.wy + 6 + off * 0.5);
        ctx.lineTo(s.span * 0.16, s.wy + 10 + off * 0.5);
        ctx.stroke();
      }
    }

    // 机徽（写实配色，机徽尺寸压缩以保持辨识度）
    ctx.globalAlpha = 0.94;
    if (o.side === 'jp') {
      ctx.fillStyle = C.jpInsignia;
      [-1, 1].forEach(function (sd) {
        ctx.beginPath();
        ctx.arc(sd * s.span * 0.38, s.wy + 1, 3.6, 0, 6.2832);
        ctx.fill();
      });
    } else {
      ctx.fillStyle = '#FFFFFF';
      [-1, 1].forEach(function (sd) {
        ctx.beginPath();
        ctx.arc(sd * s.span * 0.38, s.wy + 1, 4.8, 0, 6.2832);
        ctx.fill();
      });
      ctx.fillStyle = C.usInsignia;
      [-1, 1].forEach(function (sd) {
        ctx.beginPath();
        ctx.arc(sd * s.span * 0.38, s.wy + 1, 2.3, 0, 6.2832);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;

    // 螺旋桨
    var prop = o.prop === undefined ? 1 : o.prop;
    if (prop > 0.02) {
      var pr = o.type === 'pby' ? [s.span * 0.27, -s.span * 0.27] : [0];
      for (var p = 0; p < pr.length; p++) {
        var px = pr[p], py = p === 0 ? -s.L * 0.53 : s.wy - 12;
        ctx.globalAlpha = 0.28 * prop;
        ctx.fillStyle = '#E8EEF2';
        ctx.beginPath(); ctx.arc(px, py, 13, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 0.40 * prop;
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 13, 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 受损黑烟
    if (o.damaged) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = C.smoke;
      ctx.beginPath(); ctx.arc(2, s.L * 0.06, 9, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  };

  /* ------------------------------------------------------------------
     舰船（3/4 斜视：纵向压缩 0.7）
     ------------------------------------------------------------------ */
  Art.ship = function (ctx, o) {
    var type = o.type || 'destroyer';
    var w = o.w || 190, h = o.h || 46;
    var dmg = o.damage || 0;      // 0 完好 / 1 中破 / 2 大破
    var t = o.t || 0;

    // 航母 / 驱逐舰使用写实 sprite（保留尾迹、烟、油迹）
    if ((type === 'carrier' && spriteReady('carrier')) || (type === 'destroyer' && spriteReady('destroyer'))) {
      var img = type === 'carrier' ? sprites.carrier : sprites.destroyer;
      var srot = 0;
      var so = o;
      if (type === 'carrier') { so = { x: o.x, y: o.y, w: o.w * 0.72 }; }
      // 尾迹
      if (o.speed !== 0) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = 'rgba(230,244,250,.85)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        for (var wi = 0; wi < 3; wi++) {
          var wl = 42 + wi * 26;
          ctx.beginPath();
          ctx.moveTo(o.x - w * 0.5, o.y - 3 + wi * 3);
          ctx.lineTo(o.x - w * 0.5 - wl, o.y + 2 + wi * 5);
          ctx.stroke();
        }
        ctx.restore();
      }
      // 舰体 sprite
      Art.spriteShip(ctx, so, img, srot);
      // 烟
      if (dmg >= 1) {
        var n = dmg >= 2 ? 3 : 1;
        for (var s = 0; s < n; s++) {
          var ph = (t * 0.35 + s * 0.4) % 1;
          ctx.globalAlpha = (1 - ph) * (0.42 + 0.1 * s);
          ctx.fillStyle = s === 0 ? '#3F3F3F' : '#555555';
          var rr = 10 + ph * 34;
          ctx.beginPath();
          ctx.arc(o.x + w * 0.06 + s * 14 + ph * 26, o.y - 12 - ph * 46, rr, 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // 油迹
      if (dmg >= 2) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#0E2431';
        ctx.beginPath(); ctx.ellipse(o.x - w * 0.3, o.y + 16, 90, 16, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }

    ctx.save();
    ctx.translate(o.x, o.y);

    // 尾迹
    if (o.speed !== 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(230,244,250,.85)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (var i = 0; i < 3; i++) {
        var wl = 42 + i * 26;
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, -3 + i * 3);
        ctx.lineTo(-w * 0.5 - wl, 2 + i * 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.scale(1, 0.7);           // §9.3.4 纵向压缩
    if (dmg >= 2) ctx.rotate(0.055);  // 大破倾斜

    // 阴影（写实，更实）
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#0A1A26';
    ctx.translate(9, 22);
    hullPath(ctx, w, h); ctx.fill();
    ctx.restore();

    // 舰体（写实：深色细描边，无白描边）
    ctx.lineJoin = 'round';
    ctx.fillStyle = o.hull || C.hull;
    hullPath(ctx, w, h); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1.5;
    hullPath(ctx, w, h); ctx.stroke();

    // 水线暗部
    ctx.save();
    hullPath(ctx, w, h); ctx.clip();
    ctx.fillStyle = o.hullDark || C.hullDark;
    ctx.fillRect(-w * 0.6, h * 0.16, w * 1.2, h);
    ctx.restore();

    // 甲板 / 上层建筑
    if (type === 'carrier') carrierDeck(ctx, w, h, t, dmg);
    else if (type === 'cruiser') cruiserTop(ctx, w, h, dmg);
    else destroyerTop(ctx, w, h, dmg);

    // 损伤：甲板破洞
    if (dmg >= 1) {
      ctx.fillStyle = 'rgba(20,18,16,.75)';
      ctx.beginPath(); ctx.ellipse(w * 0.12, 0, 13, 7, 0.2, 0, 6.2832); ctx.fill();
      if (dmg >= 2) { ctx.beginPath(); ctx.ellipse(-w * 0.18, 3, 10, 5, -0.3, 0, 6.2832); ctx.fill(); }
    }
    ctx.restore();

    // 烟（不随压缩变形）
    if (dmg >= 1) {
      var n = dmg >= 2 ? 3 : 1;
      for (var s = 0; s < n; s++) {
        var ph = (t * 0.35 + s * 0.4) % 1;
        ctx.globalAlpha = (1 - ph) * (0.42 + 0.1 * s);
        ctx.fillStyle = s === 0 ? '#3F3F3F' : '#555555';
        var rr = 10 + ph * 34;
        ctx.beginPath();
        ctx.arc(o.x + w * 0.06 + s * 14 + ph * 26, o.y - 12 - ph * 46, rr, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // 油迹
    if (dmg >= 2) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#0E2431';
      ctx.beginPath(); ctx.ellipse(o.x - w * 0.3, o.y + 16, 90, 16, 0, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  function hullPath(ctx, w, h) {
    var hw = w * 0.5, hh = h * 0.5;
    ctx.beginPath();
    ctx.moveTo(-hw, -hh * 0.72);
    ctx.lineTo(hw * 0.72, -hh * 0.80);
    ctx.quadraticCurveTo(hw * 0.96, -hh * 0.42, hw * 1.02, 0);
    ctx.quadraticCurveTo(hw * 0.96, hh * 0.42, hw * 0.72, hh * 0.80);
    ctx.lineTo(-hw, hh * 0.72);
    ctx.quadraticCurveTo(-hw * 1.06, 0, -hw, -hh * 0.72);
    ctx.closePath();
  }

  function carrierDeck(ctx, w, h, t, dmg) {
    var hw = w * 0.5, hh = h * 0.5;
    // 飞行甲板（内缩，露出深色舰体边缘）
    ctx.fillStyle = C.deck;
    ctx.beginPath();
    ctx.moveTo(-hw * 0.90, -hh * 0.60);
    ctx.lineTo(hw * 0.72, -hh * 0.66);
    ctx.quadraticCurveTo(hw * 0.88, 0, hw * 0.72, hh * 0.66);
    ctx.lineTo(-hw * 0.90, hh * 0.60);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.deckEdge; ctx.lineWidth = 3; ctx.stroke();

    // 甲板木条
    ctx.strokeStyle = 'rgba(0,0,0,.13)'; ctx.lineWidth = 1.4;
    for (var x = -hw * 0.86; x < hw * 0.68; x += 26) {
      ctx.beginPath(); ctx.moveTo(x, -hh * 0.55); ctx.lineTo(x, hh * 0.55); ctx.stroke();
    }

    // 中线虚线
    ctx.strokeStyle = '#E8E2CE'; ctx.lineWidth = 2.6; ctx.setLineDash([16, 13]);
    ctx.beginPath(); ctx.moveTo(-hw * 0.84, 0); ctx.lineTo(hw * 0.56, 0); ctx.stroke();
    ctx.setLineDash([]);

    // 升降机（深色方块）
    ctx.fillStyle = 'rgba(30,26,22,.5)';
    ctx.fillRect(-hw * 0.14, -hh * 0.42, 30, hh * 0.84);
    ctx.fillRect(hw * 0.30, -hh * 0.38, 26, hh * 0.76);

    // 舰岛（左舷上缘）
    ctx.fillStyle = '#5E6673';
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(hw * 0.02, -hh * 0.86);
    ctx.lineTo(hw * 0.20, -hh * 0.86);
    ctx.lineTo(hw * 0.18, -hh * 0.58);
    ctx.lineTo(hw * 0.04, -hh * 0.58);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 烟囱
    ctx.fillStyle = '#3E4753';
    ctx.beginPath(); ctx.ellipse(hw * 0.11, -hh * 0.74, 9, 5, 0, 0, 6.2832); ctx.fill();
    // 桅杆
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(hw * 0.06, -hh * 0.86); ctx.lineTo(hw * 0.06, -hh * 1.06); ctx.stroke();

    // 甲板上的舰载机
    ctx.fillStyle = C.usLight;
    for (var i = 0; i < 3; i++) {
      var px = -hw * 0.62 + i * 30;
      ctx.beginPath();
      ctx.moveTo(px, -6);
      ctx.lineTo(px + 10, -2); ctx.lineTo(px + 10, 6);
      ctx.lineTo(px, 10); ctx.lineTo(px - 4, 6); ctx.lineTo(px - 4, -2);
      ctx.closePath(); ctx.fill();
    }
  }

  function destroyerTop(ctx, w, h, dmg) {
    var hw = w * 0.5, hh = h * 0.5;
    // 甲板
    ctx.fillStyle = C.deck;
    ctx.beginPath();
    ctx.moveTo(-hw * 0.86, -hh * 0.52);
    ctx.lineTo(hw * 0.74, -hh * 0.56);
    ctx.lineTo(hw * 0.86, 0);
    ctx.lineTo(hw * 0.74, hh * 0.56);
    ctx.lineTo(-hw * 0.86, hh * 0.52);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.deckEdge; ctx.lineWidth = 2.4; ctx.stroke();

    // 首楼 + 舰桥
    ctx.fillStyle = '#5E6673';
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(hw * 0.30, -hh * 0.62);
    ctx.lineTo(hw * 0.48, -hh * 0.62);
    ctx.lineTo(hw * 0.46, hh * 0.62);
    ctx.lineTo(hw * 0.30, hh * 0.62);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 前后主炮
    ctx.fillStyle = '#2A323C';
    ctx.beginPath(); ctx.arc(hw * 0.62, 0, 7, 0, 6.2832); ctx.fill();
    ctx.fillRect(hw * 0.66, -2.4, 18, 4.8);
    ctx.beginPath(); ctx.arc(-hw * 0.58, 0, 6.5, 0, 6.2832); ctx.fill();
    ctx.fillRect(-hw * 0.74, -2.2, 16, 4.4);

    // 烟囱
    ctx.fillStyle = '#3E4753';
    ctx.beginPath(); ctx.ellipse(hw * 0.06, 0, 12, 6.5, 0, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2; ctx.stroke();

    // 鱼雷发射管
    ctx.fillStyle = '#4E5762';
    ctx.fillRect(-hw * 0.22, -5, 26, 10);
  }

  function cruiserTop(ctx, w, h, dmg) {
    var hw = w * 0.5, hh = h * 0.5;
    // 甲板
    ctx.fillStyle = C.deck;
    ctx.beginPath();
    ctx.moveTo(-hw * 0.88, -hh * 0.54);
    ctx.lineTo(hw * 0.76, -hh * 0.58);
    ctx.lineTo(hw * 0.88, 0);
    ctx.lineTo(hw * 0.76, hh * 0.58);
    ctx.lineTo(-hw * 0.88, hh * 0.54);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.deckEdge; ctx.lineWidth = 2.4; ctx.stroke();

    // 塔式舰桥
    ctx.fillStyle = '#5E6673';
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(hw * 0.14, -hh * 0.66);
    ctx.lineTo(hw * 0.36, -hh * 0.66);
    ctx.lineTo(hw * 0.32, hh * 0.66);
    ctx.lineTo(hw * 0.16, hh * 0.66);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 三联装炮塔
    ctx.fillStyle = '#2A323C';
    [0.60, -0.26, -0.54].forEach(function (f) {
      ctx.beginPath(); ctx.arc(hw * f, 0, 9, 0, 6.2832); ctx.fill();
      for (var i = -1; i <= 1; i++) ctx.fillRect(hw * f + (f > 0 ? 7 : -25), i * 4 - 1.5, 18, 3);
    });

    // 烟囱 ×2
    ctx.fillStyle = '#3E4753';
    [0.02, -0.13].forEach(function (f) {
      ctx.beginPath(); ctx.ellipse(hw * f, 0, 10, 6, 0, 0, 6.2832); ctx.fill();
    });
  }

  /* ------------------------------------------------------------------
     特效
     ------------------------------------------------------------------ */
  Art.tracer = function (ctx, x1, y1, x2, y2, a) {
    ctx.globalAlpha = a === undefined ? 1 : a;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.tracerTail;
    ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = C.tracer;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 1;
  };

  Art.enemyTracer = function (ctx, x1, y1, x2, y2) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,120,90,.95)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,180,.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  Art.flash = function (ctx, x, y, r, a) {
    ctx.globalAlpha = a === undefined ? 1 : a;
    var g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,247,214,1)');
    g.addColorStop(0.5, 'rgba(255,200,90,.65)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  };

  Art.spark = function (ctx, x, y, r, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#FFE9A8';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  };

  Art.splash = function (ctx, x, y, r, a) {
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.5, r * 0.8, 0, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = a * 0.5;
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.4, r * 0.5, 0, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1;
  };

  Art.flak = function (ctx, x, y, r, a) {
    ctx.globalAlpha = a * 0.5;
    ctx.fillStyle = '#8A8A8A';
    ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = C.flak;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  };

  Art.smoke = function (ctx, x, y, r, a, col) {
    ctx.globalAlpha = a;
    ctx.fillStyle = col || C.smoke;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  };

  /* 小图标：用于命数显示 */
  Art.planeIcon = function (size, color) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
      '<path d="M12 2.5c1.3 0 1.9 1.7 1.9 3.6v3.2l7.1 3.4v1.9l-7.1-1.7v4.2l2.7 1.9v1.6L12 19.9l-4.6.7v-1.6l2.7-1.9v-4.2L3 14.6v-1.9l7.1-3.4V6.1c0-1.9.6-3.6 1.9-3.6z" fill="' + (color || '#FFFFFF') + '"/></svg>';
  };

  Art.starIcon = function (on) {
    return '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.4 6.2 20.4l1.1-6.4L2.6 9.4l6.5-.9z" fill="' + (on ? '#FFD34E' : 'rgba(255,255,255,.16)') + '"/></svg>';
  };

  /* ------------------------------------------------------------------
     故事卡插画（简化场景，用于 §8.1 L1）
     ------------------------------------------------------------------ */
  Art.storyScene = function (ctx, w, h, scene) {
    ctx.clearRect(0, 0, w, h);
    var env = { skyTop: C.skyTop, skyLow: C.skyLow, seaTop: C.seaLight, seaBot: C.seaDeep };
    if (scene === 'dawn') env = { skyTop: '#5E7790', skyLow: '#E8B87E', seaTop: '#3A6C82', seaBot: '#152F44', sunX: 0.68 };
    if (scene === 'noon') env = { skyTop: C.skyNoon, skyLow: '#EAF4FA', seaTop: C.seaLight, seaBot: C.seaDeep, sunCol: 'rgba(255,255,240,.95)' };
    if (scene === 'dusk') env = { skyTop: '#3A5068', skyLow: '#E8A050', seaTop: '#2A4F6B', seaBot: '#101F2E', sunX: 0.76, sunCol: 'rgba(255,190,120,.9)' };
    if (scene === 'cloud') env = { skyTop: C.skyTop, skyLow: '#E4EEF4', seaTop: C.seaMid, seaBot: C.seaDeep };

    Art.skySea(ctx, w, h, env, 0.016, 0);
    var scale = w / 1280;
    if (scene === 'carrier' || scene === 'dawn' || scene === 'dusk') {
      Art.ship(ctx, { type: 'carrier', x: w * 0.62, y: h * 0.80, w: 330 * scale, h: 80 * scale, t: 0, damage: scene === 'dusk' ? 2 : 0 });
    }
    if (scene === 'scout') {
      Art.plane(ctx, { x: w * 0.34, y: h * 0.56, ang: -0.3, type: 'pby', side: 'us', scale: 1.0 * scale, prop: 0.7 });
    } else if (scene === 'cloud') {
      Art.plane(ctx, { x: w * 0.4, y: h * 0.5, ang: 0.2, type: 'sbd', side: 'us', scale: 1.1 * scale, brakes: true, prop: 0.5 });
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(w * 0.72, h * 0.42, 150 * scale, 46 * scale, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w * 0.86, h * 0.5, 110 * scale, 38 * scale, 0, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (scene === 'swap') {
      Art.plane(ctx, { x: w * 0.3, y: h * 0.42, ang: 0.5, type: 'kate', side: 'jp', scale: 0.95 * scale, prop: 0.6 });
      Art.plane(ctx, { x: w * 0.6, y: h * 0.34, ang: -0.4, type: 'zero', side: 'jp', scale: 0.8 * scale, prop: 0.6 });
    } else if (scene === 'defend') {
      Art.plane(ctx, { x: w * 0.28, y: h * 0.5, ang: -0.5, type: 'wildcat', side: 'us', scale: 1.0 * scale, prop: 0.7 });
      Art.plane(ctx, { x: w * 0.62, y: h * 0.36, ang: 0.3, type: 'val', side: 'jp', scale: 0.85 * scale, prop: 0.6 });
    } else if (scene === 'escort') {
      Art.plane(ctx, { x: w * 0.24, y: h * 0.62, ang: 0, type: 'avenger', side: 'us', scale: 0.9 * scale, prop: 0.6 });
      Art.plane(ctx, { x: w * 0.46, y: h * 0.5, ang: 0, type: 'avenger', side: 'us', scale: 0.9 * scale, prop: 0.6 });
      Art.plane(ctx, { x: w * 0.74, y: h * 0.34, ang: -0.4, type: 'zero', side: 'jp', scale: 0.8 * scale, prop: 0.6 });
    }
  };

  /* 主菜单装饰 */
  Art.menuScene = function (ctx, w, h, t) {
    ctx.clearRect(0, 0, w, h);
    Art.skySea(ctx, w, h, { skyTop: '#5E7790', skyLow: C.skyTop, sunX: 0.7 }, 0.016, t);
    var s = w / 1280;
    Art.plane(ctx, { x: w * 0.28, y: h * 0.62, ang: -0.18, type: 'sbd', side: 'us', scale: 1.15 * s, prop: 0.65, brakes: true });
  };

})(window);
