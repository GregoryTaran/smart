import fs from "fs";
import path from "path";
import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import FormData from "form-data";

// === НАСТРОЙКИ ===
const PORT = 4000; // 🔹 свой порт
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ROOT = path.resolve(".");
const BASE_URL = `http://localhost:${PORT}`;
const APP_DIR = path.join(ROOT, "translator");

const app = express();
app.use(express.json());
app.use(express.static(APP_DIR)); // обслуживаем только папку translator

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
          ws.voice = meta.voice;
          return ws.send(`🎛 Meta ok: ${ws.sampleRate} Hz`);
        }

        if (meta.type === "silence") {
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

  ws.on("close", () => console.log(`❌ Closed ${ws.sessionId}`));
});

// === Merge ===
function mergeChunks(session) {
  console.log(`🧩 [${session}] Starting chunk merge...`);
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

  console.log(`🧩 [${session}] Merged ${files.length} chunks into ${outFile}`);
  // Удаление чанков
  files.forEach(f => fs.unlinkSync(f));
}

// === Whisper ===
app.get("/whisper", async (req, res) => {
  try {
    const { session, langPair } = req.query;
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
    let detectedLang = data.language || null;
    const text = data.text || "";

    console.log("🧠 Whisper response:", data);
    console.log("🌐 Detected language:", detectedLang || "none");

    const [a, b] = (langPair || "en-ru").split("-");
    if (!detectedLang || ![a, b].includes(detectedLang)) {
      console.log(`⚠️ Whisper misdetected (${detectedLang}), checking with GPT...`);
      const prompt = `Text: """${text}"""\nDecide which of these two languages it is written in: ${a} or ${b}. Return only one code (${a} or ${b}).`;
      const check = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const resCheck = await check.json();
      const corrected = resCheck.choices?.[0]?.message?.content?.trim().toLowerCase();
      if (corrected && [a, b].includes(corrected)) {
        detectedLang = corrected;
        console.log(`🧠 GPT corrected language → ${detectedLang}`);
      } else {
        console.log("⚠️ GPT could not correct language, fallback to", a);
        detectedLang = a;
      }
    }

    res.json({ text, detectedLang });
  } catch (e) {
    console.error("❌ Whisper error:", e.message);
    res.status(500).json({ error: e.message, detectedLang: null, text: "" });
  }
});

// === GPT ===
app.post("/gpt", async (req, res) => {
  try {
    const { text, mode, langPair, detectedLang } = req.body;
    if (!text) return res.status(400).send("No text");

    let prompt = text;
    if (mode === "translate") {
      const [a, b] = langPair.split("-");
      let from;
      if (detectedLang && [a, b].includes(detectedLang)) from = detectedLang;
      else from = a;
      const to = from === a ? b : a;
      prompt = `Translate from ${from.toUpperCase()} to ${to.toUpperCase()}: ${text}`;
    } else if (mode === "assistant") {
      prompt = `Act as a helpful assistant. Reply naturally: ${text}`;
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    res.json({ text: data.choices?.[0]?.message?.content ?? "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === TTS ===
app.get("/tts", async (req, res) => {
  try {
    const { text, session, voice } = req.query;
    if (!text) return res.status(400).send("No text");

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voice || "alloy",
        input: text,
      }),
    });

    const audio = await r.arrayBuffer();
    const file = `${session}_tts.mp3`;
    fs.writeFileSync(file, Buffer.from(audio));
    res.json({ url: `${BASE_URL}/${file}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === Helpers ===
function floatToWav(f32, sampleRate) {
  const buffer = Buffer.alloc(44 + f32.length * 2);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52494646, false);
  view.setUint32
