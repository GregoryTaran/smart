const CACHE_NAME = "smartvision-cache-v3";
const URLS_TO_CACHE = ["/", "/index.html", "/manifest.json"];

// 📦 Установка и кеширование базовых файлов
self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(URLS_TO_CACHE);
        console.log("✅ Smart Vision: файлы закешированы");
      } catch (err) {
        console.warn("⚠️ Smart Vision: кеширование не удалось:", err);
      }
      // Мгновенная активация нового SW
      self.skipWaiting();
    })()
  );
});

// ♻️ Активация и очистка старых кешей
self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
      console.log("🧹 Smart Vision: старые кеши удалены");
      // Сообщаем всем клиентам (страницам), что есть обновление
      const clientsList = await self.clients.matchAll();
      clientsList.forEach(client => client.postMessage({ type: "UPDATED" }));
      // Активируем новый SW сразу
      self.clients.claim();
    })()
  );
});

// 🌐 Fetch: network-first для HTML, cache-first для остального
self.addEventListener("fetch", event => {
  const req = event.request;

  // Для HTML (навигации) — network first
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          const cached = await caches.match(req);
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Для всего остального — cache first
  event.respondWith(
    caches.match(req).then(response => response || fetch(req))
  );
});
