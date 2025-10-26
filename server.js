import express from "express";
import path from "path";
import { WebSocketServer } from "ws";
import registerTranslator from "./smart/translator/server-translator.js";  // Подключение модуля
// import registerContext from "./smart/context/server-context.js";  // Закомментировано для отладки

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

// === Реестр активных соединений ===
let sessionCounter = 1;

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ws.module = null;  // Инициализируем module как null
  ws.sessionId = null;

  // Подтверждение соединения
  ws.send("✅ Connected to Smart Vision WS");

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (msg) => {
    try {
      // Логируем полученное сообщение
      console.log("📩 Received message:", msg);

      // Поддержка ping/pong от клиента
      if (msg.toString() === "ping-init" || msg.toString() === "ping") {
        ws.send("pong");
        return;
      }

      const data = JSON.parse(msg);

      // Логируем тип сообщения
      console.log(`📡 Message type: ${data.type}`);

      // Регистрация модуля
      if (data.type === "register") {
        console.log(`✅ Registering module: ${data.module}`);

        ws.module = data.module;  // Устанавливаем модуль
        ws.sampleRate = data.sampleRate || 44100;
        ws.sessionId = `${ws.module}-${sessionCounter++}`;
        ws.send(`SESSION:${ws.sessionId}`);
        console.log(`📡 Registered ${ws.module}: ${ws.sessionId}`);

        // Логируем успешную регистрацию модуля
        console.log(`✅ Module ${ws.module} successfully registered!`);
        return;
      }

      // Логируем, что модуль не найден
      console.log("❌ No module found for processing");

      // Маршрутизация по модулям
      if (ws.module === "translator") {
        console.log("📡 Processing binary data for translator module...");
        if (registerTranslator && typeof registerTranslator.handleBinary === "function") {
          registerTranslator.handleBinary(ws, msg);  // Обработка бинарных данных
        } else {
          console.log("❌ No handler for binary data in translator module");
        }
      } else {
        ws.send("❔ Unknown module");
      }
    } catch (e) {
      console.error("Error processing message:", e.message);
      ws.send("⚠️ Error processing message");

      // Обработка бинарных данных в случае ошибки
      if (ws.module === "translator" && typeof registerTranslator.handleBinary === "function") {
        registerTranslator.handleBinary(ws, msg);
      } else {
        ws.send("⚠️ Binary message ignored (no module)");
      }
    }
  });

  ws.on("close", () =>
    console.log(`❌ WS closed (${ws.module || "unknown"}): ${ws.sessionId}`)
  );

  ws.on("error", (err) => {
    console.warn(`⚠️ WS error: ${err.message}`);
  });
});

// ЭКО: мягкий пинг для поддержания соединений
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
