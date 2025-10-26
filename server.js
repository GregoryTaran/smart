import express from "express";
import path from "path";
import { WebSocketServer } from "ws";

import registerTranslator from "./smart/translator/server-translator.js";
import registerContext from "./smart/context/server-context.js";

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(".");

const app = express();
app.use(express.json());

// === Раздача фронтенда ===
app.use("/smart", express.static(path.join(ROOT, "smart")));
app.use(express.static(ROOT));

// === Запуск основного HTTP-сервера ===
const server = app.listen(PORT, () => {
  console.log(`🚀 Smart Vision Server started on port ${PORT}`);
  console.log(`📂 Root: ${ROOT}`);
});

// === Раздельные WebSocket-серверы для модулей ===
// Каждый модуль имеет собственный endpoint
const wssTranslator = new WebSocketServer({ server, path: "/translator/ws" });
const wssContext = new WebSocketServer({ server, path: "/context/ws" });

// === Подключение серверных модулей ===
registerTranslator(app, wssTranslator);
registerContext(app, wssContext);

// === Резерв для будущих модулей ===
// import registerVision from "./smart/vision/server-vision.js";
// const wssVision = new WebSocketServer({ server, path: "/vision/ws" });
// registerVision(app, wssVision);

console.log("🧩 Modules loaded: Translator, Context");
