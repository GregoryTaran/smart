import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import https from 'https';
import { logToFile } from './utils.js';  // Импортируем логирование

// Получаем путь к текущей директории
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const PORT = process.env.PORT || 3000;
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "certs", "cert.pem")),
};

const app = express();
const httpsServer = https.createServer(httpsOptions, app);
const wss = new WebSocketServer({ server: httpsServer });

const sessions = new Map();
let sessionCounter = 1;

app.use(express.static(path.join(__dirname, "smart")));
app.use(express.json());

// Запуск сервера
httpsServer.listen(PORT, () => {
  logToFile(`🚀 Сервер запущен на порту ${PORT}`);  // Логирование
  console.log("🌐 WebSocket и HTTPS серверы активированы.");
});

// Обработчик WebSocket-соединений
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ws.sessionId = null;
  ws.module = null;

  ws.send("✅ Подключено к Smart Vision WS");

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "register") {
        const sessionId = `sess-${sessionCounter++}`;
        ws.sessionId = sessionId;
        sessions.set(sessionId, ws);
        ws.send(`✅ Подключено. ID сессии: ${sessionId}`);
      } else {
        ws.send("❔ Неизвестный модуль");
      }
    } catch (e) {
      console.error("Ошибка при обработке сообщения:", e.message);
      logToFile(`Ошибка при обработке сообщения: ${e.message}`);  // Логирование ошибки
      ws.send("⚠️ Ошибка при обработке сообщения");
    }
  });

  ws.on("close", () => {
    logToFile(`❌ Соединение закрыто: ${ws.sessionId}`);
    sessions.delete(ws.sessionId);
  });

  ws.on("error", (err) => {
    logToFile(`⚠️ Ошибка соединения: ${err.message}`);
    console.warn(`⚠️ Ошибка соединения: ${err.message}`);
  });
});

// Периодическая проверка живости сессий (ping/pong)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);
