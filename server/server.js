/**
 * server.js
 * Центральный минимальный диспетчер / bootstrap для проекта.
 *
 * Основные идеи:
 * - Используем process.cwd() как базу для всех путей — чтобы одинаково работало и локально, и на Render.
 * - server.js старается НЕ вмещать бизнес-логику: он поднимает HTTP сервер, статические файлы,
 *   автоматически ищет модули в папке "Smart" и вызывает у них .register(...)
 * - Поддерживается регистрация WebSocket-обработчиков модулями: модули регистрируют wss по пути,
 *   а сервер выполняет роутинг upgrade-запросов на правильный WebSocketServer.
 *
 * Комментарии в коде подробно поясняют каждую строку.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');

// --- Конфигурация / объяснение порта ---
// Render (и другие хостинги) могут подавать PORT через env.
// Для тестирования по умолчанию используем 10000 (как ты просил).
const PORT = process.env.PORT || 10000;

// --- База проекта ---
// process.cwd() возвращает рабочую директорию процесса Node.js.
// Это надёжнее и консистентнее, чем __dirname в некоторых сценариях деплоя.
const ROOT = process.cwd();

// Папка, в которой лежат «модули» по твоему пожеланию.
// Ты попросил: модули лежат не в modules/, а в основной папке Smart/
const MODULES_DIR = path.resolve(ROOT, 'Smart');

// Создаём express-приложение
const app = express();

// Парсер JSON для REST-запросов
app.use(bodyParser.json());

// Простой health-check (удобно проверять, жив ли сервер)
app.get('/health', (req, res) => {
  res.json({ ok: true, pid: process.pid, root: ROOT });
});

// Статика (если нужна) — можно положить фронтенд в папку 'public'
const PUBLIC_DIR = path.resolve(ROOT, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  // '/static' будет отдавать файлы из public/
  app.use('/static', express.static(PUBLIC_DIR));
}

// --- http server ---
// Создаём HTTP сервер здесь, чтобы модули могли прикреплять WebSocket к тому же серверу.
const httpServer = http.createServer(app);

// --- WebSocket маршруты (карта пути => WebSocketServer) ---
// Модули будут регистрировать свои WSS-обработчики в этой карте.
// Мы обрабатываем событие 'upgrade' в одном месте и маршрутизируем по path.
const wsRouteMap = new Map(); // key: pathPrefix (например '/ws/sms') -> value: WebSocketServer

/**
 * registerWsRoute
 * Позволяет модулю зарегистрировать WebSocketServer под указанным URL-путём.
 * - pathPrefix: строка, например '/ws/sms'
 * - wss: instance of (require('ws')).WebSocketServer created with { noServer: true }
 */
function registerWsRoute(pathPrefix, wss) {
  if (!pathPrefix || typeof pathPrefix !== 'string') {
    throw new Error('registerWsRoute: pathPrefix must be a string');
  }
  if (!wss || typeof wss.handleUpgrade !== 'function') {
    throw new Error('registerWsRoute: wss must be a WebSocketServer (noServer: true)');
  }
  wsRouteMap.set(pathPrefix, wss);
  console.log(`Registered WS route: ${pathPrefix}`);
}

// Handle upgrade centrally: смотрим URL и передаём управление соответствующему wss
httpServer.on('upgrade', (request, socket, head) => {
  // Парсим путь (можно использовать URL API)
  const { url } = request;
  // Ищем первый route, который является префиксом для url
  for (const [prefix, wss] of wsRouteMap.entries()) {
    if (url.startsWith(prefix)) {
      // передаём обработку WebSocketServer'у, он сам завершит handshake
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return; // обработано — выходим
    }
  }

  // Если не нашли подходящий route, просто закрываем соединение корректно
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

// --- Динамическая загрузка модулей в папке Smart/ ---
// Ожидаем, что каждый модуль — это папка внутри Smart/ и внутри есть index.js
if (fs.existsSync(MODULES_DIR)) {
  const items = fs.readdirSync(MODULES_DIR, { withFileTypes: true });

  // Проходим по всем поддиректориям
  for (const it of items) {
    if (!it.isDirectory()) continue; // пропускаем файлы
    const modName = it.name;
    const modIndex = path.resolve(MODULES_DIR, modName, 'index.js');

    // Проверяем наличие index.js в папке модуля
    if (!fs.existsSync(modIndex)) {
      console.warn(`Module folder found but no index.js: ${modName} (expected ${modIndex})`);
      continue;
    }

    try {
      // Загружаем модуль и передаём ему необходимые объекты.
      // Ожидаем, что модуль экспортирует функцию register({ app, httpServer, config, registerWsRoute })
      const mod = require(modIndex);

      if (typeof mod.register === 'function') {
        mod.register({
          app,
          httpServer,
          config: { ROOT, MODULES_DIR, PUBLIC_DIR },
          registerWsRoute,
        });
        console.log(`Module registered: ${modName}`);
      } else {
        console.warn(`Module ${modName} does not export register(...) function`);
      }
    } catch (err) {
      console.error(`Failed to load module ${modName}:`, err);
    }
  }
} else {
  console.log(`Modules directory does not exist (expected: ${MODULES_DIR}). No modules loaded.`);
}

// --- Запуск сервера ---
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`ROOT: ${ROOT}`);
  console.log(`Modules directory: ${MODULES_DIR}`);
});

/**
 * Примечания:
 * - Для Render: Render задаёт переменную окружения PORT; наш код её учитывает.
 * - Для локального теста: можно экспортировать PORT=10000 (по умолчанию у нас 10000).
 * - Если ты хочешь, чтобы сервер логировал больше — добавь middleware логирования запросов (morgan).
 */
