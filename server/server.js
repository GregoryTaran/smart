import express from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import https from 'https';
import { registerHandler } from './server-translator.js';
import { logToFile } from './utils.js';

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
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
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
        registerHandler(ws, data, sessionCounter++);
        sessions.set(ws.sessionId, ws);
      } else {
        ws.send("❔ Неизвестный модуль");
      }
    } catch (e) {
      console.error("Ошибка при обработке сообщения:", e.message);
      ws.send("⚠️ Ошибка при обработке сообщения");
    }
  });

  ws.on("close", () => {
    console.log(`❌ Соединение закрыто: ${ws.sessionId}`);
    sessions.delete(ws.sessionId);
  });

  ws.on("error", (err) => {
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
