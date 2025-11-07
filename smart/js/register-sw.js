// register-sw.js (unified)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      const swUrl = new URL('service-worker.js', document.baseURI).href;
      const scopeUrl = new URL('./', document.baseURI).pathname; // scope = current base path
      navigator.serviceWorker.register(swUrl, { scope: scopeUrl })
        .catch(err => console.warn('SW register failed:', err));
    } catch (e) {
      console.warn('SW register exception:', e);
    }
  });
}
