/* Минимальная регистрация Service Worker. Оставь, либо отключи при локалке. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.warn("SW register failed:", err));
  });
}
