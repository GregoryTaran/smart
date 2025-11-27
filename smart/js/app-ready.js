// js/app-ready.js
(function () {
  if (window.APP_READY) return; // защита от повторного подключения

  window.APP_READY = (async () => {
    // ---- 1. Ждём SVID ----
    if (window.SVID?.ready) {
      try { await window.SVID.ready; } catch (e) {
        console.warn("[APP_READY] SVID.ready error:", e);
      }
    }

    // ---- 2. Ждём AUTH ----
    await new Promise((resolve) => {
      if (window.SV_AUTH?.loaded) return resolve();

      document.addEventListener(
        "sv:auth-ready",
        () => resolve(),
        { once: true }
      );
    });

    // Можно сюда добавить будущие ожидания (скины, фичи, локаль)
    return true;
  })();
})();
