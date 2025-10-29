// server/modules/voicerecorder.js
// Express router for voice recorder module
// Mount point (when used with server/server.js): /api/voicerecorder
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Use PROJECT_ROOT env if set (helps on some hosts), otherwise process.cwd()
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
const BASE_DIR = path.join(PROJECT_ROOT, 'server', 'voicerecorder_data');
const CHUNKS_DIR = path.join(BASE_DIR, 'chunks');
const OUT_DIR = path.join(BASE_DIR, 'out');

// ensure dirs
for (const d of [BASE_DIR, CHUNKS_DIR, OUT_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Accept raw ArrayBuffer (Float32LE) for chunk upload
// Modules use own body parsers to avoid interfering with global json parser
router.post('/upload-chunk', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
  try {
    const clientIdRaw = req.header('x-client-id') || 'unknown';
    const clientId = String(clientIdRaw).replace(/[^a-z0-9-_]/gi, '_');
    const seqRaw = req.header('x-seq') || '0';
    const seq = String(seqRaw).replace(/[^0-9]/g, '') || '0';
    const sampleRate = parseInt(req.header('x-sample-rate') || '48000', 10) || 48000;
    const channels = parseInt(req.header('x-channels') || '1', 10) || 1;
    const bitDepth = req.header('x-bitdepth') || '32f';

    const fname = `${clientId}_seq${String(seq).padStart(6, '0')}.pcm`;
    const outPath = path.join(CHUNKS_DIR, fname);

    fs.writeFile(outPath, req.body, (err) => {
      if (err) {
        console.error('[voicerecorder] save chunk error', outPath, err);
        return res.status(500).json({ ok: false, error: 'write_error' });
      }
      console.log('[voicerecorder] saved chunk', fname, 'sr', sampleRate, 'ch', channels, 'bd', bitDepth);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[voicerecorder] upload error', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Finish: merge client chunks (.pcm float32le) -> 16-bit PCM WAV
router.post('/finish', express.json({ limit: '1mb' }), (req, res) => {
  (async () => {
    try {
      const clientIdRaw = req.body && req.body.clientId ? String(req.body.clientId) : (req.header('x-client-id') || 'unknown');
      const clientId = clientIdRaw.replace(/[^a-z0-9-_]/gi, '_');
      const sampleRate = parseInt((req.body && req.body.sampleRate) || req.header('x-sample-rate') || '48000', 10) || 48000;
      const channels = parseInt((req.body && req.body.channels) || req.header('x-channels') || '1', 10) || 1;

      // find chunk files for client
      const files = fs.readdirSync(CHUNKS_DIR)
        .filter(f => f.startsWith(clientId + '_seq'))
        .sort();

      if (!files.length) {
        console.warn('[voicerecorder] no chunks for', clientId);
        return res.status(400).json({ ok: false, error: 'no_chunks' });
      }

      // read Float32LE chunks and convert to Int16 buffers
      const int16Parts = [];
      let totalSamples = 0;
      for (const f of files) {
        const buf = fs.readFileSync(path.join(CHUNKS_DIR, f));
        const samples = Math.floor(buf.length / 4);
        const floats = new Float32Array(buf.buffer, buf.byteOffset, samples);
        const int16 = Buffer.alloc(samples * 2);
        for (let i = 0; i < samples; i++) {
          let s = floats[i];
          if (isNaN(s)) s = 0;
          if (s > 1) s = 1;
          if (s < -1) s = -1;
          // convert float [-1,1] -> int16
          const v = s < 0 ? s * 0x8000 : s * 0x7FFF;
          int16.writeInt16LE(Math.round(v), i * 2);
        }
        int16Parts.push(int16);
        totalSamples += samples;
      }

      // build WAV header (16-bit PCM)
      const bytesPerSample = 2;
      const blockAlign = channels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataByteLength = totalSamples * bytesPerSample * channels;
      const wavHeader = Buffer.alloc(44);
      function writeString(buf, offset, str) { buf.write(str, offset, 'ascii'); }
      writeString(wavHeader, 0, 'RIFF');
      wavHeader.writeUInt32LE(36 + dataByteLength, 4);
      writeString(wavHeader, 8, 'WAVE');
      writeString(wavHeader, 12, 'fmt ');
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20); // PCM
      wavHeader.writeUInt16LE(channels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(byteRate, 28);
      wavHeader.writeUInt16LE(blockAlign, 32);
      wavHeader.writeUInt16LE(16, 34);
      writeString(wavHeader, 36, 'data');
      wavHeader.writeUInt32LE(dataByteLength, 40);

      const outFileName = `${clientId}_merged_${Date.now()}.wav`;
      const outPath = path.join(OUT_DIR, outFileName);
      const ws = fs.createWriteStream(outPath);
      ws.write(wavHeader);
      for (const p of int16Parts) ws.write(p);
      ws.end();

      console.log('[voicerecorder] merged WAV:', outPath);

      // (optional) remove chunk files after merge
      // for (const f of files) fs.unlinkSync(path.join(CHUNKS_DIR, f));

      res.json({ ok: true, merged: outFileName, path: outPath });
    } catch (err) {
      console.error('[voicerecorder] finish error', err);
      res.status(500).json({ ok: false, error: 'merge_failed' });
    }
  })();
});

module.exports = router;
