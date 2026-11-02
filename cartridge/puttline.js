/* =========================================================================
   PUTTLINE cartridge loader.

   Nine holes of mini golf with real ball physics (three.js + Rapier). This
   file is tiny: it registers the cartridge straight away, and only fetches
   the game itself (puttline-engine.js, next to this file) when a console or
   cabinet asks for it. Until then the screen says LOADING.

   Same engine API as the other cartridges:
     Puttline.create({ onExit }) → { state, update(dt), drawScreen(g, W, H),
       press("start"|"sound"), hold(k, down), click(), toMenu(), pause(p), stop(), … }

   Controls: ◀ ▶ aim · ▲ ▼ power · A putt · B overview
             while the ball rolls: A jump · B toot · START redo (once per hole each)
   ========================================================================= */
(function () {
  "use strict";
  var me = document.currentScript && document.currentScript.src;
  var base = me ? me.slice(0, me.lastIndexOf("/") + 1) : "games/puttline/";
  var FONT = '"Press Start 2P", ui-monospace, monospace';
  var loading = null;

  function load() {
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        if (window.PuttlineEngine) { resolve(); return; }
        var s = document.createElement("script");
        s.src = base + "puttline-engine.js"; s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () { loading = null; reject(new Error("Could not load Puttline")); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  function create() {
    var failed = false, startQueued = false, t = 0;
    var api = {
      WIDTH: 800, HEIGHT: 400, ready: true, focus: { x: 400, y: 200 },
      state: "menu", soundOn: true, grid: true,
      hints: {
        menu: "ENTER: START   ARROWS: AIM + POWER", menuShort: "A: START",
        play: "ARROWS: AIM + POWER   A: PUTT   B: MAP", playShort: "A:PUTT B:MAP",
        over: "ENTER / A: PLAY AGAIN", overShort: "A: AGAIN"
      },
      padLabels: { left: "\u25C0", right: "\u25B6", up: "\u25B2", down: "\u25BC", jump: "PUTT", shoot: "MAP", startPlay: "REDO" }
    };
    // Until the game arrives: a loading screen, and remember a START so it isn't lost
    api.update = function (dt) { t += dt; };
    api.drawScreen = function (g, W, H) {
      var k = W / 320, s = Math.max(8, Math.round(7 * k)), ts = Math.max(12, Math.round(22 * k));
      var grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#0b1030"); grd.addColorStop(1, "#1d0b3a");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.textAlign = "center"; g.textBaseline = "top";
      g.font = ts + "px " + FONT; g.fillStyle = "#ffd54f"; g.fillText("PUTTLINE", W / 2, H * 0.3);
      g.font = s + "px " + FONT; g.fillStyle = failed ? "#ff6b6b" : "#ffffff";
      g.fillText(failed ? "COULD NOT LOAD" : "LOADING" + ".".repeat(1 + (Math.floor(t * 3) % 3)), W / 2, H * 0.3 + ts * 1.8);
    };
    api.draw = function (g) { api.drawScreen(g, 800, 400); };
    api.press = function (k) { if (k === "sound") api.soundOn = !api.soundOn; else startQueued = true; };
    api.hold = function (k, down) { if (down && (k === "jump" || k === "shoot")) startQueued = true; };
    api.click = function () { startQueued = true; };
    api.release = api.toMenu = api.pause = api.stop = function () {};

    load().then(function () {
      var sound = api.soundOn;
      window.PuttlineEngine.attach(api);
      if (!sound && api.soundOn) api.press("sound");
      if (startQueued) api.press("start");
    }, function () { failed = true; });
    return api;
  }

  window.Puttline = { create: create };
})();
