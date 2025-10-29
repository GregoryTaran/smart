// server/voicerecorder.js
// Запуск: node server/voicerecorder.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

const BASE_DIR = path.join(__dirname, 'voicerecorder_data');
const CHUNKS_DIR = path.join(BASE_DIR, 'chunks');
const OUT_DIR = path.join(BASE_DIR, 'out');

for (const d of [BASE_DIR, CHUNKS_DIR, OUT_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Принимаем raw ArrayBuffer (Float32LE) в теле запроса
app.post('/api/voicerecorder/upload-chunk', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  const clientId = (req.header('x-client-id') || 'unknown').replace(/[^a-z0-9-_]/gi, '_');
  const seq = (req.header('x-seq') || '0').replace(/[^0-9]/g, '') || '0';
  const sampleRate = parseInt(req.header('x-sample-rate') || '48000', 10);
  const channels = parseInt(req.header('x-channels') || '1', 10);
  const bitDepth = req.header('x-bitdepth') || '32f';

  const fname = `${clientId}_seq${String(seq).padStart(6,'0')}.pcm`;
  const out = path.join(CHUNKS_DIR, fname);

  fs.writeFile(out, req.body, (err) => {
    if (err) {
      console.error('Failed to save chunk', out, err);
      return res.status(500).json({ ok: false, error: 'write_error' });
    }
    console.log('saved chunk', fname, 'sr', sampleRate, 'ch', channels, 'bd', bitDepth);
    res.json({ ok: true });
  });
});

// Finish: склеиваем все чанки клиента в один WAV
app.post('/api/voicerecorder/finish', async (req,res) => {
  try {
    const clientIdRaw = req.body && req.body.clientId ? String(req.body.clientId) : 'unknown';
    const clientId = clientIdRaw.replace(/[^a-z0-9-_]/gi, '_');
    const sampleRate = parseInt((req.body && req.body.sampleRate) || req.header('x-sample-rate') || '48000', 10) || 48000;
    const channels = parseInt((req.body && req.body.channels) || req.header('x-channels') || '1', 10) || 1;
    const bitDepth = (req.body && req.body.bitDepth) || req.header('x-bitdepth') || '32f';

    // Найти все файлы клиента
    const files = fs.readdirSync(CHUNKS_DIR)
      .filter(f => f.startsWith(clientId + '_seq'))
      .sort();

    if (!files.length) {
      console.warn('No chunks for', clientId);
      return res.status(400).json({ ok:false, error: 'no_chunks' });
    }

    // Считать и конвертировать Float32LE -> Int16LE
    const int16Buffers = [];
    let totalSamples = 0;
    for (const f of files) {
      const buf = fs.readFileSync(path.join(CHUNKS_DIR, f));
      // buf содержит Float32LE (4 bytes per sample)
      const samples = buf.length / 4;
      const floats = new Float32Array(buf.buffer, buf.byteOffset, samples);
      const int16 = Buffer.alloc(samples * 2);
      for (let i=0;i<samples;i++){
        let s = floats[i];
        if (isNaN(s)) s = 0;
        if (s > 1) s = 1;
        if (s < -1) s = -1;
        const v = s < 0 ? s * 0x8000 : s * 0x7FFF;
        int16.writeInt16LE(Math.round(v), i*2);
      }
      int16Buffers.push(int16);
      totalSamples += samples;
    }

    // Создать WAV-заголовок (16-bit PCM, mono/stereo)
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataByteLength = totalSamples * bytesPerSample * channels; // if mono, channels==1

    const wavBuffer = Buffer.alloc(44);
    function writeString(buf, offset, str){ buf.write(str, offset, 'ascii'); }
    writeString(wavBuffer, 0, 'RIFF');
    wavBuffer.writeUInt32LE(36 + dataByteLength, 4);
    writeString(wavBuffer, 8, 'WAVE');
    writeString(wavBuffer, 12, 'fmt ');
    wavBuffer.writeUInt32LE(16, 16); // subchunk1Size
    wavBuffer.writeUInt16LE(1, 20);  // PCM
    wavBuffer.writeUInt16LE(channels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(16, 34); // bits per sample
    writeString(wavBuffer, 36, 'data');
    wavBuffer.writeUInt32LE(dataByteLength, 40);

    // Объединить все int16Buffers в один
    const outFileName = `${clientId}_merged_${Date.now()}.wav`;
    const outPath = path.join(OUT_DIR, outFileName);
    const outStream = fs.createWriteStream(outPath);
    outStream.write(wavBuffer);
    for (const b of int16Buffers) outStream.write(b);
    outStream.end();

    console.log('Merged WAV created:', outPath);

    // (опционально) можно удалить исходные чанки:
    // for (const f of files) fs.unlinkSync(path.join(CHUNKS_DIR, f));

    res.json({ ok: true, merged: `/server/voicerecorder_data/out/${outFileName}`, path: outPath });
  } catch (err) {
    console.error('Finish error', err);
    res.status(500).json({ ok: false, error: 'merge_failed' });
  }
});

app.listen(PORT, ()=> console.log('voicerecorder server listening on', PORT));
