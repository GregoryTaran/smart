
// --- Импорты и настройки ---
import express from 'express';  // Модуль для работы с HTTP-запросами
import path from 'path';  // Модуль для работы с путями
import fs from 'fs';  // Модуль для работы с файловой системой
import http from 'http';  // Для создания HTTP сервера
import { WebSocketServer } from 'ws';  // Для WebSocket-соединений
import { processMessage } from './server-translator.js';  // Импортируем функцию для обработки сообщений

// --- Настройки сервера ---
const PORT = process.env.PORT || 10000;  // Устанавливаем порт для сервера
const app = express();  // Создаем экземпляр приложения Express
const httpServer = http.createServer(app);  // Создаем HTTP сервер
const wss = new WebSocketServer({ server: httpServer });  // Создаем WebSocket сервер на основе HTTP

// --- Определяем пути для index.html ---
const indexPath = path.join(process.cwd(), 'index.html');
const smartIndexPath = path.join(process.cwd(), 'smart/index.html');

// --- Статические файлы ---
app.use("/smart", express.static(path.join(process.cwd(), "smart")));  // Отдаем статику из папки "smart"

// --- Статические файлы для папки translator ---
app.use("/smart/translator", express.static(path.join(process.cwd(), "smart/translator")));  // Отдаем статику из папки "translator"

// --- Маршрут для корня сайта (/) ---
app.get("/", (req, res) => {
  console.log("Request for root (/) received");  // Логируем запрос
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);  // Отдаем файл index.html из корня
  } else {
    res.status(404).send("404 - Главная страница не найдена");  // Страница не найдена
  }
});

// --- Маршрут для /smart ---
app.get("/smart", (req, res) => {
  console.log("Request for /smart received");  // Логируем запрос
  if (fs.existsSync(smartIndexPath)) {
    res.sendFile(smartIndexPath);  // Отдаем файл index.html из папки "smart"
  } else {
    res.status(404).send("404 - Страница /smart не найдена");  // Страница не найдена
  }
});

// --- Запуск сервера ---
httpServer.listen(PORT, () => {
  console.log(`🌐 WebSocket и HTTP серверы активированы на порту ${PORT}`);
});

// --- Обработчик WebSocket-соединений ---
wss.on("connection", (ws) => {
  ws.isAlive = true;  // Устанавливаем флаг для проверки живости соединения
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);  // Генерируем уникальный ID для соединения

  // Обработка сообщений от клиента
  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      // Передаем данные на обработку в server-translator.js
      const result = await processMessage(ws, data);  // Обработка данных через server-translator.js

      // Отправляем результат обратно клиенту
      if (result) {
        ws.send(JSON.stringify({
          type: 'processedData',
          result: result
        }));
      }
    } catch (error) {
      console.error("Ошибка обработки сообщения: ", error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  // Закрытие соединения
  ws.on("close", () => {
    console.log(`❌ Соединение закрыто: ${ws.id}`);
  });
});

// Пинг/Понг для поддержания соединения
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);
