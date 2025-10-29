// server/modules/voicerecorder.js
// VoiceRecorder API module: upload, list, serve recordings.
// Saves files to process.cwd()/voicerecorder_data by default.
// Requires: npm i multer
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

module.exports = function(app, opts = {}) {
  const router = express.Router();

  const APP_ROOT = opts.APP_ROOT || process.cwd();
  const BASE_DIR = process.env.VOICERECORDER_BASE_DIR
                 || path.join(APP_ROOT, 'voicerecorder_data'); // <- uses process.cwd() as requested

  // ensure dir exists (sync at require-time is OK)
  if (!fsSync.existsSync(BASE_DIR)) {
    fsSync.mkdirSync(BASE_DIR, { recursive: true });
    console.log('Created voice recorder data dir:', BASE_DIR);
  }

  // multer setup
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, BASE_DIR),
    filename: (req, file, cb) => {
      // Keep original name but prefix timestamp to avoid clash
      const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
      cb(null, safeName);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

  // POST /api/voicerecorder/upload - form-data field name 'file'
  router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    try {
      // optional metadata processing could go here
      res.json({ ok: true, filename: req.file.filename, original: req.file.originalname, size: req.file.size });
    } catch (err) {
      console.error('Upload error', err);
      res.status(500).json({ ok: false, error: 'Upload failed' });
    }
  });

  // GET /api/voicerecorder/list - lists saved files (name, size, mtime)
  router.get('/list', async (req, res) => {
    try {
      const names = await fs.readdir(BASE_DIR);
      const items = await Promise.all(names.map(async name => {
        const st = await fs.stat(path.join(BASE_DIR, name));
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      }));
      // sort by mtime desc
      items.sort((a,b) => new Date(b.mtime) - new Date(a.mtime));
      res.json({ ok: true, baseDir: BASE_DIR, items });
    } catch (err) {
      console.error('List error', err);
      res.status(500).json({ ok: false, error: 'Could not list files' });
    }
  });

  // GET /api/voicerecorder/file/:name - serve a specific file
  router.get('/file/:name', (req, res) => {
    try {
      const name = path.basename(req.params.name); // prevent path traversal
      const full = path.join(BASE_DIR, name);
      if (!fsSync.existsSync(full)) return res.status(404).send('Not found');
      res.sendFile(full);
    } catch (err) {
      console.error('Serve file error', err);
      res.status(500).send('Error');
    }
  });

  // DELETE /api/voicerecorder/file/:name - remove a file (optional)
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

  // mount under /api/voicerecorder
  app.use('/api/voicerecorder', router);
};
