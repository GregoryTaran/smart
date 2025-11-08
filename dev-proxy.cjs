// dev-proxy.cjs
const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
require("dotenv").config();

const DEV_PORT = process.env.DEV_PORT || 5173;
const API_BASE = process.env.API_BASE || "https://test.smartvision.life";

// <<< ВАЖНО: раздаём подпапку 'smart'
const ROOT = path.join(process.cwd(), "smart");

const app = express();

// Статика из C:\SMART\smart
app.use(express.static(ROOT, { extensions: ["html"] }));

// Прокси для /api
app.use("/api", createProxyMiddleware({
  target: API_BASE,
  changeOrigin: true,
  ws: true,
  logLevel: "silent",
}));

app.listen(DEV_PORT, () => {
  console.log(`Dev server on http://localhost:${DEV_PORT}`);
  console.log(`Static root: ${ROOT}`);
  console.log(`Proxy /api -> ${API_BASE}`);
  console.log(`Open: http://localhost:${DEV_PORT}/login/login.html#login`);
});
