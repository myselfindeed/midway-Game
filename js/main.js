/* ==========================================================================
   启动
   ========================================================================== */
(function (root) {
  'use strict';
  var MG = root.MG;

  function boot() {
    var cv = document.getElementById('stage');
    MG.game.init(cv);
    MG.UI.init();

    // 调试 / 预览入口：index.html?lv=4 直接进入第 4 关；&ff=8 快进 8 秒（不影响正常游玩）
    var m = /[?&]lv=([1-5])/.exec(location.search);
    if (m) {
      var idx = parseInt(m[1], 10) - 1;
      MG.Save.data.unlocked = 5;
      MG.game.retries = 0;
      MG.game.startLevel(idx);
      var ff = /[?&]ff=(\d+)/.exec(location.search);
      if (ff) {
        MG.Input.x = MG.game.W * 0.5;
        MG.Input.y = MG.game.H * 0.6;
        var secs = parseInt(ff[1], 10);
        for (var k = 0; k < secs * 60 && MG.game.state === 'play'; k++) MG.game.update(1 / 60);
      }
    }

    var last = performance.now();
    function loop(now) {
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;           // 防跳帧
      MG.game.dt = dt;
      MG.game.update(dt);
      MG.game.render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // 离线缓存：仅 http(s) 下注册；网络优先，断网回落到缓存
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 静默失败，不影响游玩 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

})(window);
