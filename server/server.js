// server/server.js
// Главный сервер-роутер для Smart Vision
// - Статика: process.cwd()/smart
// - Порт: process.env.PORT || 10000
// - API: /api/<project>  (подключаем server/*.js роутеры вручную или автоматически)
// - Минимализм: никаких ненужных middleware, предсказуемое поведение

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const SMART_ROOT = path.join(process.cwd(), 'smart');
const PORT = process.env.PORT || 10000;

// --- basic logging (short)
app.use((req, res, next) => {
  // короткий лог — метод + url
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- mount project-specific API routers here
// Явно подключаем testserver router на /api/testserver
try {
  const testserverRouter = require('./testserver'); // server/testserver.js
  app.use('/api/testserver', testserverRouter);
  console.log('[server] mounted router: /api/testserver -> server/testserver.js');
} catch (err) {
  console.warn('[server] testserver router not mounted (missing or error):', err && err.message);
}

// --- serve static files from SMART_ROOT
// This will serve requests like:
//  GET /testserver.html  -> smart/testserver.html
//  GET /testserver/testserverclient.js -> smart/testserver/testserverclient.js
if (!fs.existsSync(SMART_ROOT)) {
  console.error(`[server] static root not found: ${SMART_ROOT}`);
  process.exit(1);
}
app.use(express.static(SMART_ROOT, {
  // disable directory listing; serve files only
  index: false,
  // maxAge: 0 // keep default or set cache headers here if needed
}));

// --- fallback: 404 for anything not found (we avoid SPA fallback to keep behavior strict)
app.use((req, res) => {
  res.status(404).send('Not found');
});

// --- error handler
app.use((err, req, res, next) => {
  console.error('[server] error:', err && (err.stack || err.message || err));
  if (!res.headersSent) res.status(500).send('Server error');
});

// --- start
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT} — static root: ${SMART_ROOT}`);
});

module.exports = app;
