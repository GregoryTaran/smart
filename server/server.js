// minimal server loader (используйте как есть)
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_ROOT = process.cwd();
const MODULES_DIR = path.join(APP_ROOT, 'server', 'modules');
const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;

const app = express();
app.use(express.json());
app.get('/api/ping', (req,res)=>res.json({ok:true}));

// loader: поддерживает function(app,opts), {prefix,router}, или router
if (fs.existsSync(MODULES_DIR)) {
  fs.readdirSync(MODULES_DIR).filter(f => f.endsWith('.js')).forEach(file => {
    const full = path.join(MODULES_DIR, file);
    try {
      delete require.cache[require.resolve(full)]; // опционально: позволяет перезагрузку модуля
      const mod = require(full);
      if (typeof mod === 'function') {
        // модуль сам монтирует роуты
        mod(app, { APP_ROOT });
        console.log('mounted module (fn):', file);
      } else if (mod && mod.prefix && mod.router) {
        app.use(mod.prefix, mod.router);
        console.log('mounted module (prefix+router):', mod.prefix);
      } else if (mod && Array.isArray(mod.stack)) {
        // express.Router
        const mount = `/api/${path.basename(file, '.js')}`;
        app.use(mount, mod);
        console.log('mounted router at', mount);
      } else {
        console.warn('unknown module shape, skipped', file);
      }
    } catch (err) {
      console.error('Failed to load module', file, err && err.message);
      // НЕ throw — продолжаем грузить остальные модули
    }
  });
}

const server = http.createServer(app);
server.listen(PORT, ()=> console.log('listening', PORT));

// graceful shutdown (k8s / Render friendly)
const graceful = () => {
  console.log('shutdown start');
  server.close(()=>{ console.log('server closed'); process.exit(0); });
  setTimeout(()=>{ console.error('force exit'); process.exit(1); }, 30_000).unref();
};
process.on('SIGINT', graceful);
process.on('SIGTERM', graceful);
