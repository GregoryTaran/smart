// server/modules/voicerecorder.js
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const crypto = require('crypto');

module.exports = function(app, opts = {}) {
  const router = express.Router();
  const APP_ROOT = opts.APP_ROOT || process.cwd();
  const BASE_DIR = process.env.VOICERECORDER_BASE_DIR || path.join(APP_ROOT, 'voicerecorder_data');
  const TMP_DIR = path.join(BASE_DIR, 'tmp');

  // ensure dirs exist
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const safe = (s) => ('' + (s || '')).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 200);

  // Accept ANY body (raw). This will accept arraybuffers/blobs sent by fetch,
  // or multipart bodies (we will just append the raw bytes — for testing that's enough).
  router.post('/upload-chunk', express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
    try {
      // Determine clientId: header x-client-id, query clientId, or generate one.
      let clientId = req.headers['x-client-id'] || req.query.clientId || req.body && req.body.clientId;
      if (!clientId) {
        // generate stable-ish id for this session
        clientId = crypto.randomUUID ? crypto.randomUUID() : crypto.createHash('sha1').update(String(Date.now() + Math.random())).digest('hex');
      }
      clientId = safe(clientId);

      // Get buffer from req.body (express.raw gives Buffer). If not a Buffer, convert.
      let chunkBuf;
      if (Buffer.isBuffer(req.body)) {
        chunkBuf = req.body;
      } else if (typeof req.body === 'string') {
        chunkBuf = Buffer.from(req.body, 'binary');
      } else if (req.body == null) {
        chunkBuf = Buffer.alloc(0);
      } else {
        // fallback: JSON/stringify
        chunkBuf = Buffer.from(JSON.stringify(req.body));
      }

      const tmpFile = path.join(TMP_DIR, `${clientId}.raw`);
      await fsp.appendFile(tmpFile, chunkBuf);

      console.log(`[voicerecorder] Accepted chunk — clientId=${clientId} bytes=${chunkBuf.length}`);

      // Return clientId so client can use it next time (idempotent)
      return res.json({ ok: true, clientId });
    } catch (err) {
      console.error('[voicerecorder] upload-chunk error', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: 'upload-chunk failed' });
    }
  });

  // Finish: move tmp -> final file (unchanged behavior) and optionally convert to WAV when requested.
  // Minimal change: conversion runs only if client asks (req.body.convert === true or ?convert=1).
  router.post('/finish', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      const clientIdRaw = req.body && req.body.clientId || req.query.clientId || req.headers['x-client-id'];
      if (!clientIdRaw) return res.status(400).json({ ok: false, error: 'clientId required' });
      const clientId = safe(clientIdRaw);

      const tmpFile = path.join(TMP_DIR, `${clientId}.raw`);
      if (!fs.existsSync(tmpFile)) return res.status(404).json({ ok: false, error: 'temp file not found' });

      // keep existing behavior: move tmp -> final raw
      const requested = req.body && req.body.filename ? String(req.body.filename) : `${Date.now()}-${clientId}.raw`;
      const finalRawName = safe(requested);
      const finalRawPath = path.join(BASE_DIR, finalRawName);

      await fsp.rename(tmpFile, finalRawPath);
      console.log(`[voicerecorder] Finished upload — clientId=${clientId} -> ${finalRawName}`);

      // If client did not request conversion, respond immediately (keeps behavior minimal)
      const wantConvert = (req.body && (req.body.convert === true || String(req.body.convert) === '1' || String(req.body.convert) === 'true')) ||
                          (req.query && (req.query.convert === '1' || req.query.convert === 'true'));
      if (!wantConvert) {
        return res.json({
          ok: true,
          filename: finalRawName,
          rawUrl: `/api/voicerecorder/file/${encodeURIComponent(finalRawName)}`,
          wavConverted: false,
          message: 'Raw saved; conversion not requested'
        });
      }

      // Conversion requested — try to run ffmpeg (non-blocking safety: we wait for ffmpeg to finish and return result)
      const sampleRate = Number(req.body.sampleRate || req.query.sampleRate || 48000);
      const channels = Number(req.body.channels || req.query.channels || 1);
      const format = String(req.body.format || req.query.format || 'f32le'); // default: float32 little-endian
      const finalWavName = finalRawName.replace(/\.raw$/i, '') + '.wav';
      const finalWavPath = path.join(BASE_DIR, finalWavName);

      const { execFile } = require('child_process');

      // quick helper: check ffmpeg availability
      const hasFFmpeg = await new Promise((resolve) => {
        execFile('ffmpeg', ['-version'], (err) => resolve(!err));
      });

      if (!hasFFmpeg) {
        console.warn('[voicerecorder] ffmpeg not found; skipping conversion');
        return res.json({
          ok: true,
          filename: finalRawName,
          rawUrl: `/api/voicerecorder/file/${encodeURIComponent(finalRawName)}`,
          wavConverted: false,
          message: 'ffmpeg not available on server; raw saved'
        });
      }

      // Build ffmpeg args: input format, sample rate, channels -> output wav
      const ffmpegArgs = [
        '-f', format,
        '-ar', String(sampleRate),
        '-ac', String(channels),
        '-i', finalRawPath,
        finalWavPath
      ];

      console.log('[voicerecorder] Running ffmpeg convert:', ffmpegArgs.join(' '));
      // Run conversion and wait; set reasonable timeout (120s)
      execFile('ffmpeg', ffmpegArgs, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('[voicerecorder] ffmpeg conversion failed', err && err.message ? err.message : err);
          // conversion failed — still return info about raw
          try {
            return res.json({
              ok: true,
              filename: finalRawName,
              rawUrl: `/api/voicerecorder/file/${encodeURIComponent(finalRawName)}`,
              wavConverted: false,
              error: 'ffmpeg conversion failed; check server logs'
            });
          } catch (e) {
            console.error('[voicerecorder] response send error after ffmpeg fail', e && e.message);
          }
        } else {
          console.log('[voicerecorder] ffmpeg conversion done ->', finalWavName);
          try {
            return res.json({
              ok: true,
              filename: finalRawName,
              rawUrl: `/api/voicerecorder/file/${encodeURIComponent(finalRawName)}`,
              wavConverted: true,
              wavName: finalWavName,
              wavUrl: `/api/voicerecorder/file/${encodeURIComponent(finalWavName)}`
            });
          } catch (e) {
            console.error('[voicerecorder] response send error after ffmpeg success', e && e.message);
          }
        }
      });

      // response will be sent inside execFile callback
    } catch (err) {
      console.error('[voicerecorder] finish error', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: 'finish failed' });
    }
  });

  // List files
  router.get('/list', async (req, res) => {
    try {
      const names = await fsp.readdir(BASE_DIR);
      const items = [];
      for (const name of names) {
        if (name === 'tmp') continue;
        const st = await fsp.stat(path.join(BASE_DIR, name));
        items.push({ name, size: st.size, mtime: st.mtime.toISOString() });
      }
      items.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      return res.json({ ok: true, items });
    } catch (err) {
      console.error('[voicerecorder] list error', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: 'list failed' });
    }
  });

  // Serve a file
  router.get('/file/:name', (req, res) => {
    try {
      const name = path.basename(String(req.params.name || ''));
      const full = path.join(BASE_DIR, name);
      if (!fs.existsSync(full)) return res.status(404).send('Not found');
      return res.sendFile(full);
    } catch (err) {
      console.error('[voicerecorder] serve file error', err && err.message ? err.message : err);
      return res.status(500).send('Error');
    }
  });

  // Delete (optional)
  router.delete('/file/:name', async (req, res) => {
    try {
      const name = path.basename(String(req.params.name || ''));
      const full = path.join(BASE_DIR, name);
      if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'Not found' });
      await fsp.unlink(full);
      return res.json({ ok: true, deleted: name });
    } catch (err) {
      console.error('[voicerecorder] delete error', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: 'Delete failed' });
    }
  });

  // Mount router under /api/voicerecorder
  app.use('/api/voicerecorder', router);
};
