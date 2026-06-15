// Phoenix Ascendant — iframe-side bridge.
//
// The Godot client calls window.PhoenixGodot.getInit()/placeBet(); since the game
// is hosted cross-origin (R2) from the arcade (Vercel), it can't touch the parent
// window directly, so this proxies those calls over postMessage. The parent owns
// auth, the session and the API bet — the game only animates the returned outcome,
// keeping every outcome server-authoritative.
(function () {
  "use strict";
  var init = null;
  var pending = {};

  function send(type, payload, reqId) {
    parent.postMessage({ source: "phoenix-game", type: type, payload: payload, reqId: reqId }, "*");
  }

  window.PhoenixGodot = {
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
    if (!m || m.source !== "phoenix-host") return;
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

  // Ask the host for the initial state as soon as the shell is parsed; the host
  // also pushes it on iframe load, so it is cached well before Godot boots.
  send("requestInit", {});
})();
