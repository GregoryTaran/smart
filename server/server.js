import express from 'express';
import path from 'path';
import http from 'http';
import { WebSocketServer } from 'ws';
import { logToFile } from './utils.js';  // Импортируем логирование
import fs from 'fs';  // Для проверки существования файлов
import { handleSessionRegistration } from './server-translator.js'; // Импортируем функцию из server-translator.js

const PORT = process.env.PORT || 10000; // Используем правильный порт, предоставленный платформой

const app = express();
const httpServer = http.createServer(app);  // Используем HTTP вместо HTTPS
const wss = new WebSocketServer({ server: httpServer });

const sessions = new Map();
let sessionCounter = 1;

// Центральное хранилище состояния сессий
const sessionState = new Map();

// Используем process.cwd() для получения абсолютного пути
const indexPath = path.join(process.cwd(), 'index.html');
const smartIndexPath = path.join(process.cwd(), 'smart', 'index.html');

// Статическая отдача файлов из папки smart
app.use("/smart", express.static(path.join(process.cwd(), "smart")));

// Главная страница (https://test.smartvision.life/)
app.get("/", (req, res) => {
  console.log("Request for root (/) received");
  logToFile("Request for root (/) received");

  // Проверяем, существует ли файл index.html в корне
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath); // Отдаём index.html из корня
  } else {
    res.status(404).send("404 - Главная страница не найдена");
  }
});

// Страница для /smart (https://test.smartvision.life/smart/)
app.get("/smart", (req, res) => {
  console.log("Request for /smart received");
  logToFile("Request for /smart received");

  // Проверяем, существует ли файл index.html в папке smart
  if (fs.existsSync(smartIndexPath)) {
    res.sendFile(smartIndexPath); // Отдаём index.html из папки smart
  } else {
    res.status(404).send("404 - Страница /smart не найдена");
  }
});

// Запуск сервера
httpServer.listen(PORT, () => {
  logToFile(`🚀 Сервер запущен на порту ${PORT}`);  // Логирование
  console.log(`🌐 WebSocket и HTTP серверы активированы на порту ${PORT}`);
});

// Обработчик WebSocket-соединений
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ws.sessionId = null;
  ws.module = null;

  // Инициализация сессии в центральном хранилище
  sessionState.set(ws.id, { status: 'connected', data: {} });

  ws.send("✅ Подключено к Smart Vision WS");

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "register") {
        const sessionId = `sess-${sessionCounter++}`;
        ws.sessionId = sessionId;
        sessions.set(sessionId, ws);

        // Передаем сессию в server-translator для добавления буквы "a"
        const updatedSessionId = handleSessionRegistration(sessionId);  // Функция добавляет букву "a" к ID

        // Обновление состояния сессии
        sessionState.set(ws.id, { status: 'registered', sessionId: updatedSessionId });

        // Отправляем обновлённый ID сессии клиенту
        ws.send(`✅ Подключено. ID сессии: ${updatedSessionId}`);
        
        // Логируем сессию на сервере
        console.log(`✅ Сессия: "${updatedSessionId}"`);
        logToFile(`✅ Сессия: "${updatedSessionId}"`);
      } else {
        ws.send("❔ Неизвестный модуль");
      }
    } catch (e) {
      console.error("Ошибка при обработке сообщения:", e.message);
      logToFile(`Ошибка при обработке сообщения: ${e.message}`);
      ws.send("⚠️ Ошибка при обработке сообщения");
    }
  });

  ws.on("close", () => {
    logToFile(`❌ Соединение закрыто: ${ws.sessionId}`);
    sessionState.delete(ws.id);  // Удаляем состояние сессии
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
      sessionState.delete(ws.id);  // Очистить состояние неактивной сессии
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);
