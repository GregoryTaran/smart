import express from "express";
import path from "path";
import { WebSocketServer } from "ws";

import registerTranslator from "./smart/translator/server-translator.js";
import registerContext from "./smart/context/server-context.js";

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(".");

const app = express();
app.use(express.json());
app.use("/smart", express.static(path.join(ROOT, "smart")));
app.use(express.static(ROOT));

const server = app.listen(PORT, () =>
  console.log(`🚀 Server started on port ${PORT}`)
);

const wss = new WebSocketServer({ server });

// === Подключение модулей ===
registerTranslator(app, wss);
registerContext(app, wss);
