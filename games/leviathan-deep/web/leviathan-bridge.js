// Leviathan's Deep — iframe-side bridge.
//
// Embedded in the arcade iframe (cross-origin: game on the R2 static host, parent owns
// auth/session/API): proxies window.LeviathanDeepGodot.getInit()/placeBet() to the parent over
// postMessage so every outcome stays server-authoritative. The host origin is locked to the
// origin of the first init message it receives. Message NAMES + SHAPES mirror the other Goldwave
// Godot clients (flaming-kirin / cosmic / dragon) exactly — only the per-game `source` prefix
// differs ("leviathan-deep-*") so this build drops straight into the same arcade host pattern.
//
// Opened standalone (not in an iframe): leaves window.LeviathanDeepGodot undefined, so the Godot
// client falls back to its built-in offline demo (mock outcomes), making the exported build
// directly loadable for QA without a host.
(function () {
  "use strict";
  if (window.parent === window) return; // standalone -> demo mode

  var init = null;
  var hostOrigin = null;
  var pending = {};

  function send(type, payload, reqId) {
    parent.postMessage(
      { source: "leviathan-deep-game", type: type, payload: payload, reqId: reqId },
      hostOrigin || "*",
    );
  }

  window.LeviathanDeepGodot = {
    getInit: function () {
      return init || { balanceMinor: 0, currency: "CREDIT", minBetMinor: 50, maxBetMinor: 10000 };
    },
    placeBet: function (betMinor, cb) {
      var reqId = "r" + Date.now() + Math.floor(Math.random() * 1e6);
      pending[reqId] = cb;
      send("placeBet", { betMinor: Number(betMinor) }, reqId);
    },
  };

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.source !== "leviathan-deep-host") return;
    if (hostOrigin === null) hostOrigin = e.origin; // lock to the first host we hear from
    if (e.origin !== hostOrigin) return;
    if (m.type === "init") {
      init = m.payload;
    } else if (m.type === "betResult" || m.type === "betError") {
      var cb = pending[m.reqId];
      delete pending[m.reqId];
      if (cb) {
        var data =
          m.type === "betError"
            ? { error: (m.payload && m.payload.message) || "error" }
            : m.payload;
        cb(JSON.stringify(data));
      }
    }
  });

  // Ask the host for initial state as soon as the shell is parsed; the host also pushes it on
  // iframe load, so it is cached well before Godot boots.
  send("requestInit", {});
})();
