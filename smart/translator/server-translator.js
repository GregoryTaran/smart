import fs from 'fs';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';

// === Настройки ===
const PORT = 4000; // Порт для сервера
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ROOT = path.resolve('.');
const BASE_URL = `http://localhost:${PORT}`;
const APP_DIR = path.join(ROOT, 'translator');

const app = express();
app.use(express.json());
app.use(express.static(APP_DIR)); // Статичные файлы из директории translator

// === Старт сервера ===
const server = app.listen(PORT, () =>
  console.log(`🚀 Translator server started on port ${PORT}`)
);

const wss = new WebSocketServer({ server });

// === WebSocket ===
let sessionCounter = 1;
wss.on('connection', (ws) => {
  ws.sampleRate = 44100;
  ws.sessionId = `sess-${sessionCounter++}`;
  ws.chunkCounter = 0;
  ws.send(`SESSION:${ws.sessionId}`);
  console.log(`🎧 [translator] New connection: ${ws.sessionId}`);

  ws.on('message', (data) => {
    if (typeof data === 'string') {
      try {
        const meta = JSON.parse(data);
        if (meta.type === 'meta') {
          ws.sampleRate = meta.sampleRate;
          ws.processMode = meta.processMode;
          ws.langPair = meta.langPair;
          ws.voice = meta.voice;
          return ws.send(`🎛 Meta ok: ${ws.sampleRate} Hz`);
        }

        if (meta.type === 'silence') {
          console.log(`🧩 [${ws.sessionId}] Silence detected, merging chunks...`);
          mergeChunks(ws.sessionId); // Запрос на склеивание
        }
      } catch {}
    } else {
      const buf = Buffer.from(data);
      const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const wav = floatToWav(f32, ws.sampleRate);
      const filename = `${ws.sessionId}_chunk_${ws.chunkCounter++}.wav`;
      fs.writeFileSync(filename, wav);
      ws.send(`💾 Saved ${filename}`);
    }
  });

  ws.on('close', () => console.log(`❌ Closed ${ws.sessionId}`));
});

// === Объединение чанков ===
function mergeChunks(session) {
  console.log(`🧩 [${session}] Starting chunk merge...`);
  const files = fs.readdirSync('.')
    .filter((f) => f.startsWith(`${session}_chunk_`))
    .sort((a, b) => +a.match(/chunk_(\d+)/)[1] - +b.match(/chunk_(\d+)/)[1]);

  if (!files.length) return console.log('No chunks to merge');

  const headerSize = 44;
  const first = fs.readFileSync(files[0]);
  const sr = first.readUInt32LE(24);
  const pcms = files.map((f) => fs.readFileSync(f).subarray(headerSize));
  const totalPCM = Buffer.concat(pcms);
  const merged = makeWav(totalPCM, sr);
  const outFile = `${session}_merged.wav`;
  fs.writeFileSync(outFile, merged);

  console.log(`🧩 [${session}] Merged ${files.length} chunks into ${outFile}`);
  // Удаление чанков
  files.forEach((f) => fs.unlinkSync(f));

  // Дальше вызываем Whisper, GPT и TTS
  processMergedFile(session, outFile);
}

// === Обработка после склейки ===
async function processMergedFile(session, filePath) {
  try {
    // Запуск Whisper
    const whisperResponse = await whisper(filePath);
    const text = whisperResponse.text;

    // Отправляем текст на GPT для перевода или ответа
    const gptResponse = await gpt(text, session);

    // Генерация озвучки
    await tts(gptResponse.text, session);

    console.log(`🧠 Finished processing ${session}`);
  } catch (e) {
    console.error(`❌ Error during file processing: ${e.message}`);
  }
}

// === Whisper ===
async function whisper(filePath) {
  // Реализуйте запрос к Whisper API для транскрипции
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('task', 'transcribe');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  const data = await response.json();
  return { text: data.text || '' };
}

// === GPT ===
async function gpt(text, session) {
  // Реализуйте запрос к GPT API для перевода или ответа
  const prompt = `Translate this text: ${text}`;
  const response = await fetch('https://api.openai.com/v1/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'text-davinci-003',
      prompt: prompt,
      max_tokens: 150,
    }),
  });

  const data = await response.json();
  return { text: data.choices[0].text.trim() };
}

// === TTS ===
async function tts(text, session) {
  // Реализуйте запрос к TTS API для генерации озвучки
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: text,
    }),
  });

  const audio = await response.arrayBuffer();
  const file = `${session}_tts.mp3`;
  fs.writeFileSync(file, Buffer.from(audio));
  return { url: `${BASE_URL}/${file}` };
}

// === Helpers ===
function floatToWav(f32, sampleRate) {
  const buffer = Buffer.alloc(44 + f32.length * 2);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + f32.length * 2, true); // Размер всего файла
  view.setUint32(8, 0x57415645, false); // WAVE
  view.setUint32(12, 0x666d7420, false); // fmt
  view.setUint32(16, 16, true); // длина fmt
  view.setUint16(20, 1, true); // Тип формата (1 - PCM)
  view.setUint16(22, 1, true); // Количество каналов
  view.setUint32(24, sampleRate, true); // Частота дискретизации
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // блок
  view.setUint16(34, 16, true); // размер сэмпла
  view.setUint32(36, 0x64617461, false); // data
  view.setUint32(40, f32.length * 2, true); // Длина данных

  for (let i = 0; i < f32.length; i++) {
    view.setInt16(44 + i * 2, f32[i] * 32767); // Преобразуем флот в 16-бит
  }

  return buffer;
}
