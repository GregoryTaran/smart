// server/server.js
'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const APP_ROOT = process.cwd();
const SMART_ROOT = path.join(APP_ROOT, 'smart');         // static root
const MODULES_DIR = path.join(APP_ROOT, 'server');      // server modules live in server/*.js or server/modules/*.js
const PORT = Number(process.env.PORT || 10000);

const app = express();

// lightweight global middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// health
app.get('/api/ping', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// ---------- DYNAMIC MODULE LOADER ----------
// Policy agreed: modules are server/<name>.js or server/modules/<name>.js
function findModuleFiles() {
  const candidates = [];
  // prefer server/modules/*.js if exists
  const modulesDir = path.join(APP_ROOT, 'server', 'modules');
  if (fs.existsSync(modulesDir)) {
    fs.readdirSync(modulesDir).filter(f => f.endsWith('.js')).forEach(f => candidates.push({ full: path.join(modulesDir, f), file: f }));
  }
  // also accept server/*.js (but skip server/server.js itself)
  if (fs.existsSync(path.join(APP_ROOT, 'server'))) {
    fs.readdirSync(path.join(APP_ROOT, 'server')).filter(f => f.endsWith('.js') && f !== 'server.js').forEach(f => {
      candidates.push({ full: path.join(APP_ROOT, 'server', f), file: f });
    });
  }
  return candidates;
}

function mountModule(modPath, fileName) {
  try {
    // clear cache to make reloads deterministic (optional)
    delete require.cache[require.resolve(modPath)];
    const mod = require(modPath);

    // 1) If module exports function(app, opts) — call it and let it mount itself
    if (typeof mod === 'function') {
      try {
        mod(app, { APP_ROOT, SMART_ROOT });
        console.log(`Mounted module (fn) ${fileName}`);
        return;
      } catch (err) {
        console.error(`Module function threw while mounting ${fileName}:`, err && err.message || err);
        return;
      }
    }

    // 2) If module exports { prefix, router }
    if (mod && mod.prefix && mod.router) {
      app.use(mod.prefix, mod.router);
      console.log(`Mounted module (prefix+router) ${mod.prefix} -> ${fileName}`);
      return;
    }

    // 3) If module is an express.Router (heuristic: has stack array)
    if (mod && Array.isArray(mod.stack)) {
      const mountAt = `/api/${path.basename(fileName, '.js')}`;
      app.use(mountAt, mod);
      console.log(`Mounted router at ${mountAt} -> ${fileName}`);
      return;
    }

    console.warn(`Skipped module (unknown export shape): ${fileName}`);
  } catch (err) {
    console.error(`Failed to load module ${fileName}:`, err && err.message || err);
    // do not throw — continue loading other modules
  }
}

// load modules
const modules = findModuleFiles();
if (modules.length === 0) {
  console.warn('No server modules found in server/modules or server/*.js');
} else {
  modules.forEach(m => mountModule(m.full, m.file));
}

// ---------- STATIC ASSETS ----------
// Serve static from SMART_ROOT (project passport requires this location). Static must be served AFTER API mounting
if (fs.existsSync(SMART_ROOT)) {
  app.use(express.static(SMART_ROOT));
  console.log('Serving static files from', SMART_ROOT);
} else {
  console.warn('Static folder not found:', SMART_ROOT);
}

// 404 fallback (strict)
app.use((req, res) => {
  res.status(404).send('Not Found');
});

// server start
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT} (APP_ROOT=${APP_ROOT})`);
});

// graceful shutdown
let shuttingDown = false;
function graceful() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Graceful shutdown...');
  server.close(err => {
    if (err) {
      console.error('Error closing server', err);
      process.exit(1);
    }
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('Force exit after timeout');
    process.exit(1);
  }, 30_000).unref();
}
process.on('SIGINT', graceful);
process.on('SIGTERM', graceful);

process.on('uncaughtException', err => {
  console.error('uncaughtException', err);
  graceful();
});
process.on('unhandledRejection', (r) => {
  console.error('unhandledRejection', r);
});
