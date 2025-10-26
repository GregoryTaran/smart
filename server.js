import express from "express";
import path from "path";
import { WebSocketServer } from "ws";
import { handleRegister, handleBinaryData } from "./messageHandler.js"; // Импортируем обработчики

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(".");
const app = express();

app.use(express.json());
app.use("/smart", express.static(path.join(ROOT, "smart")));
app.use(express.static(ROOT));

const server = app.listen(PORT, () => {
  console.log(`🚀 Smart Vision Server started on port ${PORT}`);
});

const wss = new WebSocketServer({ server });
console.log("🌐 Global WebSocket server started.");

// Реестр активных соединений
let sessionCounter = 1;

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ws.module = null;  // Инициализируем module как null
  ws.sessionId = null;

  // Подтверждение соединения
  ws.send("✅ Connected to Smart Vision WS");

  ws.on("pong", () => (ws.isAlive = true));

  // Обработка входящих сообщений
  ws.on("message", async (msg) => {
    try {
      console.log("📩 Received message:", msg);  // Логируем все сообщения

      const data = JSON.parse(msg);

      // Логируем содержимое данных
      console.log("📡 Received data:", data);

      if (data.type === "register") {
        handleRegister(ws, data, sessionCounter++); // Обрабатываем регистрацию
        return;
      }

      if (!ws.module) {
        console.log("❌ No module found for processing");
        return;
      }

      if (ws.module === "translator") {
        await handleBinaryData(ws, msg);  // Асинхронная обработка бинарных данных
      } else {
        ws.send("❔ Unknown module");
      }
    } catch (e) {
      console.error("Error processing message:", e.message);
      ws.send("⚠️ Error processing message");
    }
  });

  ws.on("close", () =>
    console.log(`❌ WS closed (${ws.module || "unknown"}): ${ws.sessionId}`)
  );

  ws.on("error", (err) => {
    console.warn(`⚠️ WS error: ${err.message}`);
  });
});

// Пинг для поддержания соединений
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  });
}, 15000);

console.log("🧩 Modules loaded: Translator");
