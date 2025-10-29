// smart/js/register-sw.js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      const swUrl = new URL('service-worker.js', location.href).href;
      navigator.serviceWorker.register(swUrl).then(reg => {
        console.log('Service Worker registered. scope:', reg.scope);
        window.__smartSWRegistration = reg;
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event('swUpdated'));
            }
          });
        });
      }).catch(err => console.warn('SW registration failed:', err));
    } catch (e) {
      console.warn('SW registration error:', e);
    }
  });
}
