// server/modules/voicerecorder.js
// Chunk-friendly VoiceRecorder module
// - POST /api/voicerecorder/upload      (single full-file upload, multer)
// - POST /api/voicerecorder/upload-chunk (accepts multipart chunk or raw binary; requires clientId)
// - POST /api/voicerecorder/finish      (finalize chunked upload -> move tmp -> final file)
// - GET  /api/voicerecorder/list
// - GET  /api/voicerecorder/file/:name
// - DELETE /api/voicerecorder/file/:name
//
// Install: npm i multer
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

module.exports = function(app, opts = {}) {
  const router = express.Router();

  const APP_ROOT = opts.APP_ROOT || process.cwd();
  const BASE_DIR = process.env.VOICERECORDER_BASE_DIR || path.join(APP_ROOT, 'voicerecorder_data');
  const TMP_DIR = path.join(BASE_DIR, 'tmp');

  // ensure dirs
  if (!fsSync.existsSync(BASE_DIR)) fsSync.mkdirSync(BASE_DIR, { recursive: true });
  if (!fsSync.existsSync(TMP_DIR)) fsSync.mkdirSync(TMP_DIR, { recursive: true });

  // utility
  const safe = s => (s || '').toString().replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 200);

  // multer for normal uploads or multipart chunk uploads
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-multer-${safe(file.originalname)}`)
  });
  const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB limit

  // --- single-file upload (keeps compatibility) ---
  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
      // Move from tmp to final place
      const finalName = `${Date.now()}-${safe(req.file.originalname)}`;
      const finalPath = path.join(BASE_DIR, finalName);
      await fs.rename(req.file.path, finalPath);
      res.json({ ok: true, filename: finalName, url: `/api/voicerecorder/file/${encodeURIComponent(finalName)}` });
    } catch (err) {
      console.error('upload error', err);
      res.status(500).json({ ok: false, error: 'Upload failed' });
    }
  });

  // --- chunk upload --- 
  // Handler to choose multer (for multipart/form-data) or raw binary
  router.post('/upload-chunk', (req, res, next) => {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.startsWith('multipart/form-data')) {
      // multer will parse field 'chunk' OR file field 'file'
      return upload.single('chunk')(req, res, err => {
        if (err) return next(err);
        req._multipartParsed = true;
        next();
      });
    }
    // else parse raw body buffer for this route
    // use express.raw middleware dynamically
    express.raw({ type: '*/*', limit: '50mb' })(req, res, err => {
      if (err) return next(err);
      next();
    });
  }, async (req, res) => {
    try {
      // Determine clientId (from header, query, or multipart field)
      let clientId = (req.headers['x-client-id'] || req.query.clientId || req.headers['session-id'] || req.query.sessionId || req.body && req.body.clientId) || null;
      // If multer parsed multipart, allow clientId from form fields
      if (req._multipartParsed && req.body && req.body.clientId) clientId = clientId || req.body.clientId;

      if (!clientId) return res.status(400).json({ ok: false, error: 'clientId required (header x-client-id or ?clientId=)' });

      clientId = safe(clientId);
      const tmpFile = path.join(TMP_DIR, `${clientId}.raw`); // raw appended file

      let chunkBuffer;
      if (req._multipartParsed && req.file) {
        // multer saved chunk to tmp file; read it and append, then remove multer temp
        chunkBuffer = await fs.readFile(req.file.path);
        await fs.unlink(req.file.path).catch(()=>{});
      } else if (Buffer.isBuffer(req.body)) {
        chunkBuffer = req.body; // express.raw produced Buffer
      } else if (typeof req.body === 'string' && req.body.length) {
        // fallback: body-parser might have turned into string
        chunkBuffer = Buffer.from(req.body, 'binary');
      } else {
        return res.status(400).json({ ok: false, error: 'No chunk body found' });
      }

      // Append chunk to tmp file (atomic append)
      await fs.appendFile(tmpFile, chunkBuffer);
      // Optionally: store last-updated timestamp
      await fs.utimes(tmpFile, new Date(), new Date()).catch(()=>{});
      res.json({ ok: true, tmp: path.basename(tmpFile) });
    } catch (err) {
      console.error('upload-chunk error', err);
      res.status(500).json({ ok: false, error: 'upload-chunk failed' });
    }
  });

  // --- finish: move tmp to final file (optionally accept metadata) ---
  // expects JSON: { clientId, filename } or query params
  router.post('/finish', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const clientId = safe(req.body.clientId || req.query.clientId || req.headers['x-client-id']);
      if (!clientId) return res.status(400).json({ ok: false, error: 'clientId required' });

      const tmpFile = path.join(TMP_DIR, `${clientId}.raw`);
      if (!fsSync.existsSync(tmpFile)) return res.status(404).json({ ok: false, error: 'temp file not found' });

      // Allow client to request filename; otherwise generate timestamp name
      const requested = req.body.filename || req.query.filename || `${Date.now()}-${clientId}.raw`;
      const finalName = safe(requested);
      const finalPath = path.join(BASE_DIR, finalName);

      // Move (rename) tmp -> final
      await fs.rename(tmpFile, finalPath);

      // respond with file info and URL (served by /file/:name)
      res.json({ ok: true, filename: finalName, url: `/api/voicerecorder/file/${encodeURIComponent(finalName)}` });
    } catch (err) {
      console.error('finish error', err);
      res.status(500).json({ ok: false, error: 'finish failed' });
    }
  });

  // --- list ---
  router.get('/list', async (req, res) => {
    try {
      const names = await fs.readdir(BASE_DIR);
      const items = await Promise.all(names.filter(n => n !== 'tmp').map(async name => {
        const st = await fs.stat(path.join(BASE_DIR, name));
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      }));
      items.sort((a,b) => new Date(b.mtime) - new Date(a.mtime));
      res.json({ ok: true, items });
    } catch (err) {
      console.error('list error', err);
      res.status(500).json({ ok: false, error: 'Could not list files' });
    }
  });

  // --- serve file ---
  router.get('/file/:name', (req, res) => {
    try {
      const name = path.basename(req.params.name);
      const full = path.join(BASE_DIR, name);
      if (!fsSync.existsSync(full)) return res.status(404).send('Not found');
      res.sendFile(full);
    } catch (err) {
      console.error('serve file error', err);
      res.status(500).send('Error');
    }
  });

  // --- delete ---
  router.delete('/file/:name', async (req, res) => {
    try {
      const name = path.basename(req.params.name);
      const full = path.join(BASE_DIR, name);
      if (!fsSync.existsSync(full)) return res.status(404).json({ ok: false, error: 'Not found' });
      await fs.unlink(full);
      res.json({ ok: true, deleted: name });
    } catch (err) {
      console.error('Delete error', err);
      res.status(500).json({ ok: false, error: 'Delete failed' });
    }
  });

  app.use('/api/voicerecorder', router);
};
