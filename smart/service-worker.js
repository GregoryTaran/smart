// Очень минимальный SW: кэш базовой статики, сеть приоритетна.
const CACHE = "sv-static-v1";
const ASSETS = [
  "./index.html",
  "./menu.html",
  "./topbar.html",
  "./footer.html",
  "./css/main.css",
  "./js/fragment-load.js",
  "./index/index.css",
  "./index/index.js",
  "./assets/logo400.jpg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  e.respondWith(fetch(request).catch(() => caches.match(request)));
});
