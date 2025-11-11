// DEV KILL-SWITCH: полностью отключаем работу SW в разработке
// - не кэшируем ничего
// - сразу разрегистрируемся
// - не перехватываем fetch

self.addEventListener('install', (event) => {
  // даже не кэшируем — сразу активируемся
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // удаляем все кэши
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // разрегистрируем сервис-воркер
    await self.registration.unregister();
    // возвращаем контроль страницам
    await self.clients.claim();
  })());
});

// ВАЖНО: НЕТ обработчика 'fetch' → ничего не перехватываем.
// Браузер ходит в сеть напрямую.
