// server/server.js
// Минимальный сервер-роутер для Smart Vision
// Использует process.cwd(), root = process.cwd()/smart
// Порт: process.env.PORT || 10000
// Отдаёт статические файлы, пробует .html, пробует /dir/index.html, иначе отдаёт main index.html (SPA fallback)

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const SMART_ROOT = path.join(process.cwd(), 'smart'); // <-- как ты просил
const PORT = process.env.PORT || 10000;

// helper: безопасно разрешить путь внутри SMART_ROOT
function resolveSafeRel(relPath) {
  try {
    // убираем query/hash
    const clean = decodeURIComponent(relPath.split('?')[0].split('#')[0]);
    // если корень — вернём /index.html
    const want = clean === '/' ? '/index.html' : clean;
    const abs = path.join(SMART_ROOT, want);
    const normalized = path.normalize(abs);
    const normRoot = path.normalize(SMART_ROOT + path.sep);
    if (!normalized.startsWith(normRoot)) return null;
    return normalized;
  } catch (e) {
    return null;
  }
}

async function existsFile(p) {
  try {
    const stat = await fs.promises.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

// Static quick middleware for assets: if file exists, stream it (speeds up common cases)
app.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const candidate = resolveSafeRel(req.path);
  if (candidate && await existsFile(candidate)) {
    return res.sendFile(candidate);
  }
  return next();
});

// Fallback GET handler: try .html / index.html / SPA index
app.get('*', async (req, res) => {
  try {
    // try exact path + .html
    const tryHtml = resolveSafeRel(req.path.endsWith('.html') ? req.path : req.path + '.html');
    if (tryHtml && await existsFile(tryHtml)) {
      return res.sendFile(tryHtml);
    }

    // try directory index (e.g. /foo -> /foo/index.html)
    const dirIndex = resolveSafeRel(path.join(req.path, 'index.html'));
    if (dirIndex && await existsFile(dirIndex)) {
      return res.sendFile(dirIndex);
    }

    // SPA main index
    const mainIndex = path.join(SMART_ROOT, 'index.html');
    if (await existsFile(mainIndex)) {
      return res.sendFile(mainIndex);
    }

    // nothing found
    return res.status(404).send('Not found');
  } catch (err) {
    console.error('[server] serve error', err);
    return res.status(500).send('Server error');
  }
});

// start
const server = app.listen(PORT, () => {
  console.log(`[server] Smart static server — root=${SMART_ROOT} — listening on ${PORT}`);
});

module.exports = server;
