// server/server.js
// Minimal server: отдаёт статические файлы из <project-root>/smart
// и автоматически подключает модули из server/modules/*.js
const express = require('express');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 10000;
const APP_ROOT = process.cwd();             // <- use process.cwd() (requested)
const SMART_ROOT = path.join(APP_ROOT, 'smart');
const MODULES_DIR = path.join(APP_ROOT, 'server', 'modules');

const app = express();
app.use(express.json());

// Mount modules: each module should export a function (app) => void or (router) => router
if (fs.existsSync(MODULES_DIR)) {
  fs.readdirSync(MODULES_DIR).forEach(file => {
    if (!file.endsWith('.js')) return;
    const modPath = path.join(MODULES_DIR, file);
    try {
      const mod = require(modPath);
      if (typeof mod === 'function') {
        // If module exports a function, call it with app; module chooses its own prefix
        mod(app, { APP_ROOT, SMART_ROOT });
        console.log('Mounted module:', file);
      } else if (mod && mod.router && mod.prefix) {
        app.use(mod.prefix, mod.router);
        console.log('Mounted router:', mod.prefix, '->', file);
      } else {
        console.warn('Module', file, 'does not export function or {prefix,router}');
      }
    } catch (err) {
      console.error('Failed to load module', file, err);
    }
  });
} else {
  console.warn('No modules directory found at', MODULES_DIR);
}

// Static front
if (fs.existsSync(SMART_ROOT)) {
  app.use(express.static(SMART_ROOT));
  console.log('Serving static from', SMART_ROOT);
} else {
  console.warn('Static folder not found:', SMART_ROOT);
}

// Basic API health check
app.get('/api/ping', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

// 404 fallback (explicit, predictable)
app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT} (APP_ROOT=${APP_ROOT})`);
});
