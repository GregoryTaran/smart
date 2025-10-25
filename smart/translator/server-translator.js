import fs from "fs";
import path from "path";
import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import FormData from "form-data";

// === НАСТРОЙКИ ===
const PORT = 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ROOT = path.resolve(".");
const BASE_URL = `http://localhost:${PORT}`;
const APP_DIR = path.join(ROOT, "translator");

const app = express();
app.use(express.json());
app.use(express.static(APP_DIR));

// === СТАРТ СЕРВЕРА ===
const server = app.listen(PORT, () =>
  console.log(`🚀 Translator server started on port ${PORT}`)
);
const wss = new WebSocketServer({ server });

// === WebSocket ===
let sessionCounter = 1;
wss.on("connection", (ws) => {
  ws.sampleRate = 44100;
  ws.sessionId = `sess-${sessionCounter++}`;
  ws.chunkCounter = 0;
  ws.send(`SESSION:${ws.sessionId}`);
  console.log(`🎧 [translator] New connection: ${ws.sessionId}`);

  ws.on("message", (data) => {
    if (typeof data === "string") {
      try {
        const meta = JSON.parse(data);
        if (meta.type === "meta") {
          ws.sampleRate = meta.sampleRate;
          ws.processMode = meta.processMode;
          ws.langPair = meta.langPair;
          return ws.send(`🎛 Meta ok: ${ws.sampleRate} Hz`);
        }
        if (meta.type === "silence") {
          // Запрос на склеивание
          const session = ws.sessionId;
          console.log(`🧩 [${session}] Silence detected, merging chunks`);
          mergeChunks(session);
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

  ws.on("close", () => console.log(`❌ Closed ${ws.sessionId}`));
});

// === Merge ===
function mergeChunks(session) {
  const files = fs.readdirSync(".")
    .filter(f => f.startsWith(`${session}_chunk_`))
    .sort((a, b) => +a.match(/chunk_(\d+)/)[1] - +b.match(/chunk_(\d+)/)[1]);

  if (!files.length) return console.log("No chunks to merge");

  const headerSize = 44;
  const first = fs.readFileSync(files[0]);
  const sr = first.readUInt32LE(24);
  const pcms = files.map(f => fs.readFileSync(f).subarray(headerSize));
  const totalPCM = Buffer.concat(pcms);
  const merged = makeWav(totalPCM, sr);
  const outFile = `${session}_merged.wav`;
  fs.writeFileSync(outFile, merged);

  console.log(`🧩 Merged ${files.length} chunks into ${outFile}`);
  // Удаление чанков
  files.forEach(f => fs.unlinkSync(f));
}

// === Whisper ===
app.get("/whisper", async (req, res) => {
  try {
    const { session } = req.query;
    const file = `${session}_merged.wav`;
    if (!fs.existsSync(file)) return res.status(404).send("No file");

    const form = new FormData();
    form.append("file", fs.createReadStream(file));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("task", "transcribe");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    const data = await r.json();
    const text = data.text || "";
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === GPT ===
app.post("/gpt", async (req, res) => {
  try {
    const { text } = req.body;
    const r = await fetch("https://api.openai.com/v1/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-davinci-003",
        prompt: text,
        max_tokens: 150,
      }),
    });

    const data = await r.json();
    res.json({ text: data.choices[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === TTS ===
app.get("/tts", async (req, res) => {
  try {
    const { text } = req.query;
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", input: text }),
    });

    const audio = await r.arrayBuffer();
    const file = `${req.query.session}_tts.mp3`;
    fs.writeFileSync(file, Buffer.from(audio));
    res.json({ url: `${BASE_URL}/${file}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === Helpers ===
function makeWav(pcm, sr) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
