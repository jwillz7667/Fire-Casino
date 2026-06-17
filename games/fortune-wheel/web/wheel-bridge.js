// Fortune Wheel — iframe-side bridge.
//
// Embedded in the arcade iframe (cross-origin: game on R2, parent owns auth/session/API):
// proxies window.WheelGodot.getInit()/placeBet() to the parent over postMessage so every
// outcome stays server-authoritative. placeBet carries per-bet params (the selected risk).
//
// Opened standalone (not in an iframe): leaves window.WheelGodot undefined, so the Godot
// client falls back to its built-in offline demo (mock outcomes) for QA.
(function () {
  "use strict";
  if (window.parent === window) return; // standalone → demo mode

  var init = null;
  var pending = {};
  var hostOrigin = null; // locked to the first arcade host that talks to us

  function send(type, payload, reqId) {
    // Target the concrete host origin once known; the only pre-lock message is the empty
    // requestInit, which carries nothing sensitive, so "*" there is harmless.
    parent.postMessage({ source: "wheel-game", type: type, payload: payload, reqId: reqId }, hostOrigin || "*");
  }

  window.WheelGodot = {
    getInit: function () {
      return init || { balanceMinor: 0, currency: "CREDIT", minBetMinor: 1000, maxBetMinor: 2000000 };
    },
    // paramsJson is a JSON string of game-specific bet params, e.g. '{"risk":"HIGH"}'.
    placeBet: function (betMinor, paramsJson, cb) {
      var reqId = "r" + Date.now() + Math.floor(Math.random() * 1e6);
      pending[reqId] = cb;
      var params = {};
      try { params = paramsJson ? JSON.parse(paramsJson) : {}; } catch (e) { params = {}; }
      send("placeBet", { betMinor: Number(betMinor), params: params }, reqId);
    },
  };

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.source !== "wheel-host") return;
    // Lock to the first host origin, then reject any other frame spoofing the channel.
    if (hostOrigin === null) hostOrigin = e.origin;
    else if (e.origin !== hostOrigin) return;
    if (m.type === "init") {
      init = m.payload;
    } else if (m.type === "betResult" || m.type === "betError") {
      var cb = pending[m.reqId];
      delete pending[m.reqId];
      if (cb) {
        var data = m.type === "betError" ? { error: (m.payload && m.payload.message) || "error" } : m.payload;
        cb(JSON.stringify(data));
      }
    }
  });

  send("requestInit", {});
})();
