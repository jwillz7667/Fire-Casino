// Royal Ascendant — iframe-side bridge.
//
// Embedded in the arcade iframe (cross-origin: game on the arcade origin's static
// host, parent owns auth/session/API): proxies window.RoyalGodot.getInit()/placeBet()
// to the parent over postMessage so every outcome stays server-authoritative.
//
// Opened standalone (not in an iframe): leaves window.RoyalGodot undefined, so the
// Godot client falls back to its built-in offline demo (mock outcomes). That makes
// the exported build directly loadable for QA without a host.
(function () {
  "use strict";
  if (window.parent === window) return; // standalone → demo mode

  var init = null;
  var pending = {};

  function send(type, payload, reqId) {
    parent.postMessage({ source: "royal-game", type: type, payload: payload, reqId: reqId }, "*");
  }

  window.RoyalGodot = {
    getInit: function () {
      return init || { balanceMinor: 0, currency: "CREDIT", minBetMinor: 1000, maxBetMinor: 2000000 };
    },
    placeBet: function (betMinor, cb) {
      var reqId = "r" + Date.now() + Math.floor(Math.random() * 1e6);
      pending[reqId] = cb;
      send("placeBet", { betMinor: Number(betMinor) }, reqId);
    },
  };

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.source !== "royal-host") return;
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

  // Ask the host for initial state as soon as the shell is parsed; the host also
  // pushes it on iframe load, so it is cached well before Godot boots.
  send("requestInit", {});
})();
