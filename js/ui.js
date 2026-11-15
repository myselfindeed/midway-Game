/* ==========================================================================
   界面层：主菜单 / 战役地图 / 故事卡 / 简报 / HUD / 结算 / 历史档案 / 家长面板
   ========================================================================== */
(function (root) {
  'use strict';
  var MG = root.MG, Art = MG.Art, U = MG.U;
  var UI = MG.UI = {};
  var $ = function (id) { return document.getElementById(id); };
  var overlay, hudEl, cache = {};

  UI.init = function () {
    overlay = $('overlay');
    hudEl = $('hud');

    // 暂停
    $('btnPause').addEventListener('click', function () { MG.Audio.ui(); UI.pause(); });

    // 俯冲（长按蓄力 / 松开投弹）
    var bomb = $('btnBomb');
    bomb.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      MG.game.bombHeld = true;
      MG.game.beginDive();
    });
    var release = function (e) {
      if (!MG.game.bombHeld) return;
      e.preventDefault();
      MG.game.bombHeld = false;
      if (MG.game.diveMode) MG.game.endDive();
    };
    bomb.addEventListener('pointerup', release);
    bomb.addEventListener('pointercancel', release);
    bomb.addEventListener('pointerleave', release);

    // 紧急闪避
    $('btnSkill').addEventListener('click', function () {
      var p = MG.game.player;
      if (!p || MG.Save.data.lvl < 4) return;
      if (MG.game.diveMode || p.dashCD > 0) return;
      p.dashCD = 20;
      p.invuln = 1.5;
      p.y = Math.max(MG.game.H * MG.C.PLAY_TOP, p.y - 70);
      MG.Audio.ui();
      MG.game.addParticles(p.x, p.y + 30, 10, 'ring', { col: '#3FA9C9' });
    });

    // 首次手势解锁音频
    var unlock = function () { MG.Audio.init(); MG.Audio.resume(); };
    document.addEventListener('pointerdown', unlock, { once: true });

    UI.menu();
  };

  /* ---------------- 通用 ---------------- */
  function setOverlay(html, cls) {
    overlay.className = 'overlay ' + (cls || 'dim');
    overlay.innerHTML = html;
    overlay.scrollTop = 0;
  }
  UI.clearOverlay = function () {
    overlay.className = 'overlay';
    overlay.innerHTML = '';
  };

  /* ---------------- 主菜单 ---------------- */
  UI.menu = function () {
    MG.game.state = 'menu';
    hudEl.classList.add('hidden');
    setOverlay(
      '<div class="screen menu">' +
        '<h1 id="mtitle">中途岛</h1>' +
        '<div class="tag">1942 · 太平洋 · 中途岛海战</div>' +
        '<div class="actions">' +
          '<button class="btn" id="btnStart">开始战役</button>' +
          '<button class="btn ghost sm" id="btnSettings">设置</button>' +
        '</div>' +
        '<div class="hint">单指拖动 · 自动开火 · 竖屏触控</div>' +
      '</div>', 'bare');

    $('btnStart').addEventListener('click', function () { MG.Audio.ui(); UI.map(); });
    $('btnSettings').addEventListener('click', UI.settings);
  };

  /* ---------------- 战役地图 ---------------- */
  UI.map = function () {
    MG.game.state = 'map';
    hudEl.classList.add('hidden');
    var save = MG.Save.data;
    var nodes = MG.LEVELS.map(function (lv, i) {
      var locked = lv.id > save.unlocked;
      var stars = save.stars[lv.id] || 0;
      var st = '';
      for (var s = 0; s < 3; s++) st += s < stars ? '★' : '☆';
      return '<div class="node ' + (locked ? 'locked' : '') + ' ' + (stars ? 'done' : '') + '" data-i="' + i + '">' +
        '<div class="no">' + lv.no + '</div>' +
        '<div class="nm">' + lv.title + '</div>' +
        '<div class="st">' + (locked ? '未解锁' : st) + '</div>' +
      '</div>';
    }).join('');

    setOverlay(
      '<div class="screen">' +
        '<div class="mapbar"><h2>1942 · 中途岛</h2><p>选择战役任务 · 已通关 ' + (save.unlocked - 1) + ' / 5</p></div>' +
        '<div class="nodes">' + nodes + '</div>' +
        '<div class="row" style="justify-content:center;margin-top:28px">' +
          '<button class="btn ghost sm" id="btnBackMenu">返回</button>' +
        '</div>' +
      '</div>', 'solid');

    Array.prototype.forEach.call(overlay.querySelectorAll('.node'), function (el) {
      el.addEventListener('click', function () {
        var i = parseInt(el.getAttribute('data-i'), 10);
        if (MG.LEVELS[i].id > MG.Save.data.unlocked) { MG.Audio.alarm(); return; }
        MG.Audio.ui();
        UI.story(i, 0);
      });
    });
    $('btnBackMenu').addEventListener('click', UI.menu);
  };

  /* ---------------- 故事卡 ---------------- */
  UI.story = function (li, ci) {
    MG.game.state = 'story';
    var lv = MG.LEVELS[li];
    var text = lv.story[ci];
    setOverlay(
      '<div class="screen story">' +
        '<div class="art"><canvas id="storyCv"></canvas></div>' +
        '<div class="line">' + text + '</div>' +
        '<div class="dots">' + lv.story.map(function (_, i) {
          return '<i class="' + (i <= ci ? 'on' : '') + '"></i>';
        }).join('') + '</div>' +
        '<button class="btn" id="btnNextStory">' + (ci === lv.story.length - 1 ? '出发' : '继续') + '</button>' +
      '</div>', 'solid');

    var cv = $('storyCv');
    var w = cv.parentNode.clientWidth || 600;
    var h = cv.parentNode.clientHeight || 240;
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = h * dpr;
    var cx = cv.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Art.storyScene(cx, w, h, lv.scene);

    MG.Audio.ui();
    $('btnNextStory').addEventListener('click', function () {
      MG.Audio.ui();
      if (ci + 1 < lv.story.length) UI.story(li, ci + 1);
      else UI.brief(li);
    });
  };

  /* ---------------- 任务简报 ---------------- */
  UI.brief = function (li) {
    MG.game.state = 'brief';
    var lv = MG.LEVELS[li];
    setOverlay(
      '<div class="screen brief">' +
        '<div class="k">任务简报</div>' +
        '<h2>' + lv.title + '</h2>' +
        '<div class="meta">' + lv.brief.meta + '</div>' +
        '<div class="task">' + lv.brief.task + '</div>' +
        '<div class="acts">' +
          '<button class="btn" id="btnGo">起飞</button>' +
          '<button class="btn ghost" id="btnBackMap">返回地图</button>' +
        '</div>' +
      '</div>', 'solid');

    $('btnGo').addEventListener('click', function () {
      MG.Audio.ui();
      UI.clearOverlay();
      MG.game.retries = 0;
      MG.game.startLevel(li);
    });
    $('btnBackMap').addEventListener('click', function () { MG.Audio.ui(); UI.map(); });
  };

  /* ---------------- 进入战斗 ---------------- */
  UI.enterPlay = function () {
    hudEl.classList.remove('hidden');
    UI.clearOverlay();
    cache = {};
    $('btnBomb').classList.toggle('hidden', !(MG.game.level && MG.game.level.plane === 'sbd'));
    $('btnSkill').classList.toggle('hidden', MG.Save.data.lvl < 4);
  };

  /* ---------------- HUD ---------------- */
  UI.hud = function (d) {
    if (cache.lives !== d.lives || cache.maxLives !== d.maxLives) {
      var h = '';
      for (var i = 0; i < 3; i++) h += '<i class="' + (i < d.lives ? '' : 'off') + '">' + Art.planeIcon(24, '#FFFFFF') + '</i>';
      $('lives').innerHTML = h;
      cache.lives = d.lives; cache.maxLives = d.maxLives;
    }
    if (cache.hp !== d.hp || cache.maxHp !== d.maxHp) {
      var a = '';
      for (var j = 0; j < d.maxHp; j++) a += '<i class="' + (j < d.hp ? '' : 'off') + '"></i>';
      $('armor').innerHTML = a;
      cache.hp = d.hp; cache.maxHp = d.maxHp;
    }
    var pct = Math.round(U.clamp(d.progress, 0, 1) * 100);
    if (cache.pct !== pct) { $('progFill').style.width = pct + '%'; cache.pct = pct; }

    if (cache.lvl !== d.lvl) {
      $('lvTag').textContent = 'Lv.' + d.lvl;
      var nxt = MG.C.LV_XP[Math.min(d.lvl, MG.C.LV_MAX - 1)] || 1;
      var curv = MG.C.LV_XP[d.lvl - 1] || 0;
      var p = d.lvl >= MG.C.LV_MAX ? 1 : (d.xp - curv) / Math.max(1, nxt - curv);
      $('xpFill').style.width = Math.round(U.clamp(p, 0, 1) * 100) + '%';
      cache.lvl = d.lvl;
    }

    var bomb = $('btnBomb');
    if (!bomb.classList.contains('hidden')) {
      bomb.style.opacity = MG.game.diveMode ? '1' : (d.diveReady ? '1' : '0.45');
    }
    var sk = $('btnSkill');
    if (!sk.classList.contains('hidden')) {
      sk.classList.toggle('cool', d.skillCD > 0);
    }
  };

  UI.subtitle = function (text) {
    var el = $('subtitle');
    if (!text) { el.classList.remove('on'); return; }
    el.textContent = text;
    el.classList.add('on');
  };

  /* ---------------- 结算 ---------------- */
  UI.showResult = function (r) {
    hudEl.classList.add('hidden');
    var stars = '';
    for (var i = 0; i < 3; i++) stars += Art.starIcon(i < r.stars);

    setOverlay(
      '<div class="screen result">' +
        '<h2>' + r.level.title + '</h2>' +
        '<div class="stars">' + stars + '</div>' +
        '<p style="color:#8FA0AE;font-size:16px;line-height:1.7;margin-top:14px">' + r.note + '</p>' +
        '<div class="stat">' +
          '<div>获得经验<b>+' + r.xp + '</b></div>' +
          '<div>击落 / 击沉<b>' + r.kills + '</b></div>' +
          '<div>当前等级<b>Lv.' + MG.Save.data.lvl + '</b></div>' +
        '</div>' +
        '<div class="acts"><button class="btn" id="btnNext">继续</button></div>' +
      '</div>', 'dim');

    if (MG.game.newLevel) {
      var n = MG.game.newLevel;
      MG.game.newLevel = 0;
      var names = { 2: '双发机枪', 3: '机体加固', 4: '紧急闪避', 5: '炸弹强化' };
      var tip = document.createElement('div');
      tip.style.cssText = 'margin-top:18px;color:#FFD34E;font-size:17px;text-align:center';
      tip.textContent = '升级！Lv.' + n + ' · ' + (names[n] || '');
      overlay.querySelector('.result').appendChild(tip);
    }

    $('btnNext').addEventListener('click', function () {
      MG.Audio.ui();
      UI.archive(MG.game.level, MG.game.li);
    });
  };

  UI.showFail = function (lv, li) {
    hudEl.classList.add('hidden');
    setOverlay(
      '<div class="screen result">' +
        '<h2>任务失败</h2>' +
        '<p style="color:#8FA0AE;font-size:17px;line-height:1.8;margin-top:18px">' +
          '座机受损，本次任务未能完成。<br>已获得的经验仍将保留。' +
        '</p>' +
        '<div class="acts">' +
          '<button class="btn" id="btnRetry">重新出击</button>' +
          '<button class="btn ghost" id="btnBackMap2">返回地图</button>' +
        '</div>' +
      '</div>', 'dim');

    $('btnRetry').addEventListener('click', function () {
      MG.Audio.ui();
      UI.clearOverlay();
      hudEl.classList.remove('hidden');
      MG.game.retry();
    });
    $('btnBackMap2').addEventListener('click', function () { MG.Audio.ui(); UI.map(); });
  };

  /* ---------------- 战史档案 ---------------- */
  UI.archive = function (lv, li) {
    MG.game.state = 'archive';
    var a = lv.archive;
    setOverlay(
      '<div class="screen archive">' +
        '<div class="k">战史档案</div>' +
        '<p class="fact">' + a.fact + '</p>' +
        '<div class="row" style="margin-top:22px">' +
          (lv.id < 5 ? '<button class="btn" id="btnNextLv">下一任务</button>' : '<button class="btn" id="btnFinish">返回战役地图</button>') +
          '<button class="btn ghost" id="btnBackMap3">返回地图</button>' +
        '</div>' +
      '</div>', 'solid');

    var nb = $('btnNextLv');
    if (nb) nb.addEventListener('click', function () {
      MG.Audio.ui();
      MG.game.retries = 0;
      UI.story(li + 1, 0);
    });
    var fb2 = $('btnFinish');
    if (fb2) fb2.addEventListener('click', function () { MG.Audio.ui(); UI.map(); });
    $('btnBackMap3').addEventListener('click', function () { MG.Audio.ui(); UI.map(); });
  };

  /* ---------------- 暂停 ---------------- */
  UI.pause = function () {
    if (MG.game.state !== 'play') return;
    MG.game.state = 'pause';
    setOverlay(
      '<div class="screen pause">' +
        '<h2>暂停</h2>' +
        '<div class="actions">' +
          '<button class="btn" id="btnResume">继续任务</button>' +
          '<button class="btn ghost" id="btnRestart">本关重来</button>' +
          '<button class="btn ghost" id="btnQuit">返回地图</button>' +
        '</div>' +
      '</div>', 'dim');

    $('btnResume').addEventListener('click', function () {
      MG.Audio.ui();
      UI.clearOverlay();
      MG.game.state = 'play';
    });
    $('btnRestart').addEventListener('click', function () {
      MG.Audio.ui();
      UI.clearOverlay();
      MG.game.state = 'play';
      MG.game.retry();
    });
    $('btnQuit').addEventListener('click', function () { MG.Audio.ui(); UI.map(); });
  };

  /* ---------------- 设置 ---------------- */
  UI.settings = function () {
    var s = MG.Save.data;
    function sw(on) { return '<button class="switch ' + (on ? 'on' : '') + '"><i></i></button>'; }
    setOverlay(
      '<div class="screen settings">' +
        '<h2>设置</h2>' +
        '<div class="item"><span>音效</span>' + sw(s.sfxOn) + '</div>' +
        '<div class="item"><span>减弱镜头运动</span>' + sw(s.reduceMotion) + '</div>' +
        '<div class="item"><span>清除游戏进度</span><button class="btn ghost sm" id="btnClear">清除</button></div>' +
        '<div class="row" style="margin-top:26px"><button class="btn" id="btnCloseP">返回</button></div>' +
        '<p style="margin-top:22px;font-size:13px;color:#8FA0AE;line-height:1.8">' +
          '本游戏不联网上传任何数据，进度仅保存在本机浏览器。' +
        '</p>' +
      '</div>', 'solid');

    var switches = overlay.querySelectorAll('.switch');
    switches[0].addEventListener('click', function () {
      s.sfxOn = !s.sfxOn; MG.Audio.sfxOn = s.sfxOn; MG.Save.save(); UI.settings();
    });
    switches[1].addEventListener('click', function () {
      s.reduceMotion = !s.reduceMotion; MG.Save.save(); UI.settings();
    });
    $('btnClear').addEventListener('click', function () {
      MG.Save.clear();
      MG.Audio.enabled = true; MG.Audio.sfxOn = true;
      UI.settings();
    });
    $('btnCloseP').addEventListener('click', function () { MG.Audio.ui(); UI.menu(); });
  };

})(window);
