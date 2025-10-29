// server/server.js
// Минимальный static-сервер для папки smart/
// Автор: Smart Vision — комментарии для читаемости

const express = require('express');
const path = require('path');
const app = express();

const SMART_ROOT = path.join(__dirname, '..', 'smart');
const PORT = process.env.PORT || 10000;

// Отдаём статические файлы (например /css/app.css, /index.html, /menu.html и т.д.)
app.use(express.static(SMART_ROOT, { extensions: ['html'] }));

// Здесь можно регистрировать API-роуты, например: app.use('/api', apiRouter);

// SPA fallback — все нерешённые запросы отдать index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(SMART_ROOT, 'index.html'));
});

app.listen(PORT, () => console.log(`Static server listening on ${PORT}`));
