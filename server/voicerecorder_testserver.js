// Пример: node server/voicerecorder_testserver.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

const CHUNKS_DIR = path.join(__dirname, 'voicerecorder_chunks');
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });

// raw chunk endpoint: body is raw ArrayBuffer (Float32 LE)
app.post('/api/voicerecorder/upload-chunk', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  const clientId = req.header('x-client-id') || 'unknown';
  const seq = req.header('x-seq') || '0';
  const sr = req.header('x-sample-rate') || '48000';
  const ch = req.header('x-channels') || '1';
  const bd = req.header('x-bitdepth') || '32f';
  const fname = `${clientId}_seq${seq}.pcm`;
  const out = path.join(CHUNKS_DIR, fname);
  fs.writeFile(out, req.body, (err) => {
    if (err) {
      console.error('write chunk err', err);
      return res.status(500).send('err');
    }
    console.log('saved chunk', fname, 'sr', sr, 'ch', ch, 'bd', bd);
    res.sendStatus(200);
  });
});

// finish endpoint (можно склеить позже)
app.post('/api/voicerecorder/finish', (req,res) => {
  const { clientId, lastSeq } = req.body || {};
  console.log('finish', clientId, lastSeq);
  // тут можно запустить склейку .pcm -> .wav и запуск Whisper
  res.json({ ok: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log('VOICEREC server listening', PORT));
