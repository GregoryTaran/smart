import express from "express";
import path from "path";
import { WebSocketServer } from "ws";

import registerTranslator from "./smart/translator/server-translator.js";
import registerContext from "./smart/context/server-context.js";
// import registerVision from "./smart/vision/server-vision.js";

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
  ws.module = null;
  ws.sessionId = null;

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (msg) => {
    // попытка парсить JSON
    try {
      const data = JSON.parse(msg);

      // регистрация клиента
      if (data.type === "register") {
        ws.module = data.module;
        ws.sampleRate = data.sampleRate || 44100;
        ws.sessionId = `${ws.module}-${sessionCounter++}`;
        ws.send(`SESSION:${ws.sessionId}`);
        console.log(`📡 Registered ${ws.module}: ${ws.sessionId}`);
        return;
      }

      // маршрутизация по модулям
      if (ws.module === "translator") registerTranslator.handle(ws, data);
      else if (ws.module === "context") registerContext.handle(ws, data);
      // else if (ws.module === "vision") registerVision.handle(ws, data);
      else ws.send("❔ Unknown module");
    } catch (e) {
      // не JSON — вероятно бинарные данные
      if (ws.module === "translator") registerTranslator.handleBinary(ws, msg);
      else if (ws.module === "context") registerContext.handleBinary(ws, msg);
    }
  });

  ws.on("close", () =>
    console.log(`❌ WS closed (${ws.module || "unknown"}): ${ws.sessionId}`)
  );
});

// === Периодический ping для Render ===
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

console.log("🧩 Modules loaded: Translator, Context");
