// server/server.js
'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const APP_ROOT = process.cwd();
const SMART_ROOT = path.join(APP_ROOT, 'smart');
const MODULES_DIR = path.join(APP_ROOT, 'server', 'modules');

const PORT = parseInt(process.env.PORT || '10000', 10);

const app = express();

// Basic middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Basic security headers (no extra deps)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  next();
});

// Health checks
app.get('/api/ping', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Dynamic modules loader
function loadModules() {
  if (!fs.existsSync(MODULES_DIR)) {
    console.warn('Modules dir not found:', MODULES_DIR);
    return;
  }

  const files = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const full = path.join(MODULES_DIR, file);
    try {
      // clear require cache so hot deploys pick up changes (optionally)
      delete require.cache[require.resolve(full)];
      const mod = require(full);

      // 1) function(app, opts)
      if (typeof mod === 'function') {
        try {
          mod(app, { APP_ROOT, SMART_ROOT });
          console.log('Mounted module (fn):', file);
          continue;
        } catch (err) {
          console.error('Module function threw:', file, err);
          continue;
        }
      }

      // 2) object with prefix & router
      if (mod && mod.prefix && mod.router) {
        app.use(mod.prefix, mod.router);
        console.log('Mounted module (prefix+router):', mod.prefix, '->', file);
        continue;
      }

      // 3) express.Router directly (heuristic: has "stack" array)
      if (mod && Array.isArray(mod.stack)) {
        const mountPath = `/api/${path.basename(file, '.js')}`;
        app.use(mountPath, mod);
        console.log('Mounted router at', mountPath, '->', file);
        continue;
      }

      console.warn('Module not mounted (unknown export shape):', file);
    } catch (err) {
      console.error('Failed to load module', file, 'Error:', err && err.message ? err.message : err);
      // continue loading other modules
    }
  }
}

// load modules at start
loadModules();

// Serve static front if exists
if (fs.existsSync(SMART_ROOT)) {
  app.use(express.static(SMART_ROOT));
  console.log('Serving static from', SMART_ROOT);
} else {
  console.warn('Static folder not found:', SMART_ROOT);
}

// 404
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT} (APP_ROOT=${APP_ROOT})`);
});

// graceful shutdown
let shuttingDown = false;
const graceful = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Graceful shutdown initiated');
  server.close(err => {
    if (err) {
      console.error('Error closing server', err);
      process.exit(1);
    }
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('Forcing shutdown');
    process.exit(1);
  }, 30_000).unref();
};

process.on('SIGINT', graceful);
process.on('SIGTERM', graceful);

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
  // try to shutdown gracefully
  graceful();
});

process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection at', p, 'reason', reason);
});
