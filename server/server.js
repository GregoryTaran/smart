// server/server.js
// Thin server loader: serves smart/ static and dynamically mounts routers from server/modules/*.js
// Usage: node server/server.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SMART_ROOT = path.join(process.cwd(), 'smart');
const MODULES_DIR = path.join(process.cwd(), 'server', 'modules');

// basic logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
  next();
});

// global json body parser for simple endpoints (modules may override)
app.use(express.json({ limit: '2mb' }));

// serve static site
if (!fs.existsSync(SMART_ROOT)) {
  console.error(`[server] static root not found: ${SMART_ROOT}`);
  process.exit(1);
}
app.use(express.static(SMART_ROOT, { index: 'index.html' }));

// dynamically mount modules from server/modules/*.js
if (fs.existsSync(MODULES_DIR)) {
  const files = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const modPath = path.join(MODULES_DIR, f);
    try {
      // clear cache to allow replacing module files without server restart if desired
      delete require.cache[require.resolve(modPath)];
      const router = require(modPath);
      if (!router || !router.stack) {
        console.warn(`[server] module ${f} does not export an Express router — skipping`);
        continue;
      }
      const mountPoint = '/api/' + path.basename(f, '.js');
      app.use(mountPoint, router);
      console.log(`[server] mounted ${mountPoint} -> ${modPath}`);
    } catch (err) {
      console.error(`[server] failed to mount module ${f}:`, err && err.stack || err);
    }
  }
} else {
  console.warn('[server] modules directory not found:', MODULES_DIR);
}

// 404 fallback (static root covers normal pages)
app.use((req, res) => res.status(404).send('Not found'));

// error handler
app.use((err, req, res, next) => {
  console.error('[server] error:', err && (err.stack || err.message) || err);
  if (!res.headersSent) res.status(500).send('Server error');
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT} — static root: ${SMART_ROOT}`);
});

module.exports = app;
