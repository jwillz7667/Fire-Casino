// Inferno Link — iframe-side bridge.
//
// Embedded in the arcade iframe (cross-origin: game on R2, parent owns auth/session/API):
// proxies window.InfernoGodot.getInit()/placeBet() to the parent over postMessage so every
// outcome stays server-authoritative.
//
// Opened standalone (not in an iframe): leaves window.InfernoGodot undefined, so the Godot
// client falls back to its built-in offline demo (mock outcomes) for QA.
(function () {
  "use strict";
  if (window.parent === window) return; // standalone → demo mode

  var init = null;
  var pending = {};
  var hostOrigin = null;

  function send(type, payload, reqId) {
    parent.postMessage({ source: "inferno-game", type: type, payload: payload, reqId: reqId }, hostOrigin || "*");
  }

  window.InfernoGodot = {
    getInit: function () {
      return init || { balanceMinor: 0, currency: "CREDIT", minBetMinor: 1000, maxBetMinor: 2000000 };
    },
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
    if (!m || m.source !== "inferno-host") return;
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
