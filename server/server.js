import express from 'express';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import http from 'http';
import { logToFile } from './utils.js';  // Импортируем логирование

// Получаем путь к текущей директории
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);  // Используем HTTP вместо HTTPS
const wss = new WebSocketServer({ server: httpServer });

const sessions = new Map();
let sessionCounter = 1;

// Статическая отдача файлов из папки smart
app.use("/smart", express.static(path.join(__dirname, "smart")));

// Главная страница (https://test.smartvision.life/)
app.get("/", (req, res) => {
  console.log("Request for root (/) received");
  logToFile("Request for root (/) received");
  res.sendFile(path.join(__dirname, "index.html")); // Отдаём index.html из корня
});

// Страница для /smart (https://test.smartvision.life/smart/)
app.get("/smart", (req, res) => {
  console.log("Request for /smart received");
  logToFile("Request for /smart received");
  res.sendFile(path.join(__dirname, "smart", "index.html")); // Отдаём index.html из папки smart
});

// Запуск сервера
httpServer.listen(PORT, () => {
  logToFile(`🚀 Сервер запущен на порту ${PORT}`);  // Логирование
  console.log("🌐 WebSocket и HTTP серверы активированы.");
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
