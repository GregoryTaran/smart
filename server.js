import fs from "fs";
import express from "express";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const app = express();
const server = app.listen(PORT, () => console.log(`🚀 Server started on ${PORT}`));
const wss = new WebSocketServer({ server });

app.use(express.static(".")); // раздаём файлы из текущей папки

// ✅ Публичный базовый URL для ссылок
const PUBLIC_BASE_URL = (process.env.BASE_PUBLIC_URL || "https://test.smartvision.life").replace(/\/$/, "");

// 🔑 Ключи
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// 🎙️ Каждое подключение — новая сессия
let sessionCounter = 1;

wss.on("connection", (ws) => {
  ws.sampleRate = 44100;
  ws.sessionId = `sess-${sessionCounter++}`;
  ws.chunkCounter = 0;
  ws.send(`SESSION:${ws.sessionId}`);
  console.log(`🎧 New connection: ${ws.sessionId}`);

  ws.on("message", (data) => {
    // если это JSON с метаданными
    if (typeof data === "string" || data instanceof String) {
      try {
        const json = JSON.parse(data);
        if (json.type === "meta" && json.sampleRate) {
          ws.sampleRate = json.sampleRate;
          ws.send(`🎛 SampleRate confirmed: ${ws.sampleRate} Hz`);
          return;
        }
      } catch {}
    }

    // 📦 бинарный аудиоблок
    const buf = Buffer.from(data);
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const wav = floatToWav(f32, ws.sampleRate);

    const filename = `${ws.sessionId}_chunk_${ws.chunkCounter++}.wav`;
    fs.writeFileSync(filename, wav);

    const fileUrl = `${PUBLIC_BASE_URL}/${filename}`;
    ws.send(`💾 Saved ${filename} — ${fileUrl}`);
  });

  ws.on("close", () => console.log(`❌ Closed: ${ws.sessionId}`));
});

// 📦 Объединение чанков
app.get("/merge", (req, res) => {
  try {
    const session = (req.query.session || "").trim();
    if (!session) return res.status(400).send("No session");

    const files = fs.readdirSync(".")
      .filter(f => f.startsWith(`${session}_chunk_`))
      .sort((a, b) => +a.match(/chunk_(\d+)/)[1] - +b.match(/chunk_(\d+)/)[1]);

    if (!files.length) return res.status(404).send("No chunks for session");

    const headerSize = 44;
    const first = fs.readFileSync(files[0]);
    const sampleRate = first.readUInt32LE(24);

    const pcms = files.map(f => fs.readFileSync(f).subarray(headerSize));
    const totalPCM = Buffer.concat(pcms);

    const byteLen = totalPCM.length;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + byteLen, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(byteLen, 40);

    const merged = Buffer.concat([header, totalPCM]);
    const mergedFile = `${session}_merged.wav`;
    fs.writeFileSync(mergedFile, merged);

    console.log(`🧩 Created ${mergedFile}`);
    res.setHeader("Content-Type", "audio/wav");
    res.download(mergedFile);
  } catch (err) {
    console.error("❌ Merge error:", err);
    res.status(500).send("Merge error");
  }
});

// 🧠 Whisper → текст
app.get("/whisper", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).send("Missing OPENAI_API_KEY");
    const session = (req.query.session || "").trim();
    if (!session) return res.status(400).send("No session id");

    const file = `${session}_merged.wav`;
    if (!fs.existsSync(file)) return res.status(404).send("File not found");

    const buf = fs.readFileSync(file);
    const blob = new Blob([buf], { type: "audio/wav" });
    const form = new FormData();
    form.append("file", blob, file);
    form.append("model", "whisper-1");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Whisper error");

    console.log(`🧠 Whisper → ${data.text}`);
    res.json({ text: data.text });
  } catch (e) {
    console.error("❌ Whisper error:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 🔊 TTS — озвучка текста через Google Cloud
app.get("/tts", async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.status(500).send("Missing GOOGLE_API_KEY");

    const text = (req.query.text || "").trim();
    const session = (req.query.session || "tts").trim();
    if (!text) return res.status(400).send("No text provided");

    const body = {
      input: { text },
      voice: { languageCode: "ru-RU", name: "ru-RU-Wavenet-D" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.0 },
    };

    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "TTS error");

    const audio = Buffer.from(data.audioContent, "base64");
    const outFile = `${session}_tts.mp3`;
    fs.writeFileSync(outFile, audio);

    const url = `${PUBLIC_BASE_URL}/${outFile}`;
    console.log(`🔊 TTS ready: ${url}`);

    res.json({ url });
  } catch (e) {
    console.error("❌ TTS error:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- WAV helper ---
function floatToWav(float32Array, sampleRate = 44100) {
  const buffer = Buffer.alloc(44 + float32Array.length * 2);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + float32Array.length * 2, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, float32Array.length * 2, true);

  let offset = 44;
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
