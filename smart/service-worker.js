// Simple service worker: cache shell and serve offline. Version updates when SW file changes.
const CACHE_NAME = 'smart-vision-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/about.html',
  '/page1.html',
  '/page2.html',
  '/page3.html',
  '/page4.html',
  '/page5.html',
  '/css/app.css',
  '/js/fragment-load.js',
  '/js/fragment-load.js', // ensure listed
  '/menu.html',
  '/topbar.html',
  '/footer.html',
  '/manifest.json'
];

// Install - cache core assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(()=>{}))
  );
});

// Activate - cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Fetch - try cache first, fallback to network, and put new requests into cache (cache-first for same-origin)
self.addEventListener('fetch', event => {
  const req = event.request;
  // only handle GET requests
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // do not try to handle cross-origin requests (fonts/images from CDN etc)
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // put a copy in cache asynchronously
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => {
          // avoid caching opaque responses
          try { cache.put(req, copy); } catch(e) {}
        });
        return res;
      }).catch(() => {
        // offline fallback: try to serve index.html for navigation requests
        if (req.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});