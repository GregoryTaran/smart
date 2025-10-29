// smart/service-worker.js
const SW_VERSION = 'minimal-1';
self.addEventListener('install', () => {
  console.log(`[SW ${SW_VERSION}] install`);
  // Ничего не кешируем
});
self.addEventListener('activate', () => {
  console.log(`[SW ${SW_VERSION}] activate`);
  // Не claim, не skipWaiting
});
// Нет обработчика fetch — SW не вмешивается в сетевые запросы
