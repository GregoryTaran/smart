// server/modules/voicerecorder.js
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const router = express.Router();

module.exports = function(app, opts = {}) {
  const APP_ROOT = opts.APP_ROOT || process.cwd();
  const BASE_DIR = process.env.VOICERECORDER_BASE_DIR || path.join(APP_ROOT, 'voicerecorder_data');
  const TMP_DIR = path.join(BASE_DIR, 'tmp');

  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  // try to require multer but don't fail if missing
  let multer = null;
  try {
    multer = require('multer');
  } catch (err) {
    console.warn('multer not installed — multipart uploads disabled. Install multer to enable them.');
  }

  const safe = s => (s||'').toString().replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 200);

  // helper: append chunk (raw buffer)
  async function appendChunk(clientId, buffer) {
    const tmpFile = path.join(TMP_DIR, `${clientId}.raw`);
    await fsp.appendFile(tmpFile, buffer);
    await fsp.utimes(tmpFile, new Date(), new Date()).catch(()=>{});
    return tmpFile;
  }

  // multipart upload endpoint if multer available
  if (multer) {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, TMP_DIR),
      filename: (req, file, cb) => cb(null, `${Date.now()}-multer-${safe(file.originalname)}`)
    });
    const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

    router.post('/upload', upload.single('file'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
        const finalName = `${Date.now()}-${safe(req.file.originalname)}`;
        const dest = path.join(BASE_DIR, finalName);
        await fsp.rename(req.file.path, dest);
        res.json({ ok: true, filename: finalName, url: `/api/voicerecorder/file/${encodeURIComponent(finalName)}` });
      } catch (err) {
        console.error('upload error', err);
        res.status(500).json({ ok: false, error: 'Upload failed' });
      }
    });

    // support multipart chunk field 'chunk'
    router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
      try {
        const clientId = safe(req.body.clientId || req.query.clientId || req.headers['x-client-id']);
        if (!clientId) return res.status(400).json({ ok: false, error: 'clientId required' });
        if (!req.file) return res.status(400).json({ ok: false, error: 'No chunk file' });
        const chunk = await fsp.readFile(req.file.path);
        await fsp.unlink(req.file.path).catch(()=>{});
        await appendChunk(clientId, chunk);
        res.json({ ok: true });
      } catch (err) {
        console.error('upload-chunk error', err);
        res.status(500).json({ ok: false, error: 'upload-chunk failed' });
      }
    });
  } // end if multer

  // raw chunk endpoint (works without multer)
  router.post('/upload-chunk', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
      const clientId = safe(req.query.clientId || req.headers['x-client-id'] || (req.body && req.body.clientId));
      if (!clientId) return res.status(400).json({ ok: false, error: 'clientId required' });
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      await appendChunk(clientId, buffer);
      res.json({ ok: true });
    } catch (err) {
      console.error('raw upload-chunk error', err);
      res.status(500).json({ ok: false, error: 'upload-chunk failed' });
    }
  });

  // finish
  router.post('/finish', express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const clientId = safe(req.body.clientId || req.query.clientId || req.headers['x-client-id']);
      if (!clientId) return res.status(400).json({ ok: false, error: 'clientId required' });

      const tmpFile = path.join(TMP_DIR, `${clientId}.raw`);
      if (!fs.existsSync(tmpFile)) return res.status(404).json({ ok: false, error: 'temp file not found' });

      const requested = req.body.filename || req.query.filename || `${Date.now()}-${clientId}.raw`;
      const finalName = safe(requested);
      const finalPath = path.join(BASE_DIR, finalName);

      await fsp.rename(tmpFile, finalPath);
      res.json({ ok: true, filename: finalName, url: `/api/voicerecorder/file/${encodeURIComponent(finalName)}` });
    } catch (err) {
      console.error('finish error', err);
      res.status(500).json({ ok: false, error: 'finish failed' });
    }
  });

  // list / file / delete
  router.get('/list', async (req, res) => {
    try {
      const names = (await fsp.readdir(BASE_DIR)).filter(n => n !== 'tmp');
      const items = await Promise.all(names.map(async name => {
        const st = await fsp.stat(path.join(BASE_DIR, name));
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      }));
      items.sort((a,b)=> new Date(b.mtime) - new Date(a.mtime));
      res.json({ ok: true, items });
    } catch (err) {
      console.error('list error', err);
      res.status(500).json({ ok: false, error: 'Could not list files' });
    }
  });

  router.get('/file/:name', (req, res) => {
    try {
      const name = path.basename(req.params.name);
      const full = path.join(BASE_DIR, name);
      if (!fs.existsSync(full)) return res.status(404).send('Not found');
      res.sendFile(full);
    } catch (err) {
      console.error('serve file error', err);
      res.status(500).send('Error');
    }
  });

  router.delete('/file/:name', async (req, res) => {
    try {
      const name = path.basename(req.params.name);
      const full = path.join(BASE_DIR, name);
      if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'Not found' });
      await fsp.unlink(full);
      res.json({ ok: true, deleted: name });
    } catch (err) {
      console.error('Delete error', err);
      res.status(500).json({ ok: false, error: 'Delete failed' });
    }
  });

  // mount at /api/voicerecorder
  app.use('/api/voicerecorder', router);
};

// also export router+prefix so server loader can mount it in other styles
module.exports.router = router;
module.exports.prefix = '/api/voicerecorder';
