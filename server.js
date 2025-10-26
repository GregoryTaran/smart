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

  // подтверждение соединения
  ws.send("✅ Connected to Smart Vision WS");

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (msg) => {
    try {
      // поддержка ping/pong от клиента
      if (msg.toString() === "ping-init" || msg.toString() === "ping") {
        ws.send("pong");
        return;
      }

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
      // бинарные данные
      if (ws.module === "translator") registerTranslator.handleBinary(ws, msg);
      else if (ws.module === "context") registerContext.handleBinary(ws, msg);
      else ws.send("⚠️ Binary message ignored (no module)");
    }
  });

  ws.on("close", () =>
    console.log(`❌ WS closed (${ws.module || "unknown"}): ${ws.sessionId}`)
  );

  ws.on("error", (err) => {
    console.warn(`⚠️ WS error: ${err.message}`);
  });
});

// === ЭКО: мягкий пинг (Render-friendly) ===
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

console.log("🧩 Modules loaded: Translator, Context");
