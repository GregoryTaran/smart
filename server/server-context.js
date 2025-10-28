// server/server-context.js
// Модуль "context" — сборка аудиочанков, merge -> whisper -> gpt -> tts.
// - Экспорт: `router`, `prefix`, и `init(app, server)` для WebSocket (опционально).
// - Использует process.cwd() для хранения wav/tts файлов.
// - В endpoints минимальная валидация и подробные комментарии.

import express from "express";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import { WebSocketServer } from "ws";

export const prefix = "/context";
export const router = express.Router();

// Путь хранения — корень проекта (process.cwd()) по архитектурному контракту
const CHUNKS_DIR = process.cwd();

// Для приёма бинарных чанков (Float32Array) используем raw middleware
const rawMiddleware = express.raw({ type: "application/octet-stream", limit: "30mb" });

// --- === Набор вспомогательных функций === ---

/**
 * Convert Float32Array -> WAV (16-bit PCM little-endian) as Buffer
 * - sampleRate: integer (обычно 44100)
 * - f32: Float32Array
 */
function floatToWav(f32, sampleRate) {
  // Создаём Buffer с заголовком 44 байта и PCM16 данных
  const pcmLen = f32.length * 2;
  const buffer = Buffer.alloc(44 + pcmLen);
  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmLen, 4);
  buffer.write("WAVE", 8);
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);          // PCM header size
  buffer.writeUInt16LE(1, 20);           // PCM format (1)
  buffer.writeUInt16LE(1, 22);           // mono
  buffer.writeUInt32LE(sampleRate, 24);  // sample rate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32);           // block align
  buffer.writeUInt16LE(16, 34);          // bits per sample
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmLen, 40);

  // write samples
  let offset = 44;
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, offset);
    offset += 2;
  }
  return buffer;
}

/**
 * listChunks(session) -> sorted filenames for session
 */
function listChunks(session) {
  if (!fs.existsSync(CHUNKS_DIR)) return [];
  return fs.readdirSync(CHUNKS_DIR)
    .filter(f => f.startsWith(`${session}_chunk_`))
    .sort((a,b)=>{
      const na = +(a.match(/chunk_(\d+)/)||[])[1] || 0;
      const nb = +(b.match(/chunk_(\d+)/)||[])[1] || 0;
      return na - nb;
    });
}

// === HTTP endpoints (router) ===

/**
 * POST /context/chunk?session=...&sampleRate=...
 * - body: application/octet-stream (Float32Array.buffer)
 * - saves chunk as `${session}_chunk_<idx>.wav` in CHUNKS_DIR
 */
router.post("/chunk", rawMiddleware, (req, res) => {
  try {
    const session = String(req.query.session || `sess-${Date.now()}`);
    const sampleRate = parseInt(String(req.query.sampleRate || "44100"), 10);

    if (!req.body || !req.body.byteLength) return res.status(400).json({ error: "no_body" });

    // Buffer -> Float32Array (Node Buffer backing ArrayBuffer)
    const buf = Buffer.from(req.body);
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));

    const idx = listChunks(session).length;
    const filename = `${session}_chunk_${idx}.wav`;
    const wav = floatToWav(f32, sampleRate);
    fs.writeFileSync(path.join(CHUNKS_DIR, filename), wav);

    return res.json({ ok: true, file: filename });
  } catch (e) {
    console.error("[context/chunk] error:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "chunk_save_error", message: e && e.message ? e.message : String(e) });
  }
});

/**
 * GET /context/merge?session=...
 * - читает все `${session}_chunk_*` файлы, объединяет PCM и пишет `${session}_merged.wav`
 * - возвращает { ok:true, file: "/<session>_merged.wav" }
 */
router.get("/merge", (req, res) => {
  try {
    const session = String(req.query.session || "");
    if (!session) return res.status(400).send("no session");

    const files = listChunks(session);
    if (!files.length) return res.status(404).send("no chunks");

    const headerSize = 44;
    const first = fs.readFileSync(path.join(CHUNKS_DIR, files[0]));
    const sr = first.readUInt32LE(24); // sampleRate from header

    // concat pcm payloads without headers
    const pcmParts = files.map(f => fs.readFileSync(path.join(CHUNKS_DIR, f)).subarray(headerSize));
    const mergedPCM = Buffer.concat(pcmParts);

    // build merged wav header + data
    const outHeader = Buffer.alloc(44);
    outHeader.write("RIFF", 0);
    outHeader.writeUInt32LE(36 + mergedPCM.length, 4);
    outHeader.write("WAVE", 8);
    outHeader.write("fmt ", 12);
    outHeader.writeUInt32LE(16, 16);
    outHeader.writeUInt16LE(1, 20);
    outHeader.writeUInt16LE(1, 22);
    outHeader.writeUInt32LE(sr, 24);
    outHeader.writeUInt32LE(sr * 2, 28);
    outHeader.writeUInt16LE(2, 32);
    outHeader.writeUInt16LE(16, 34);
    outHeader.write("data", 36);
    outHeader.writeUInt32LE(mergedPCM.length, 40);

    const merged = Buffer.concat([outHeader, mergedPCM]);
    const outFile = `${session}_merged.wav`;
    fs.writeFileSync(path.join(CHUNKS_DIR, outFile), merged);

    // возвращаем путь (static server в главном server.js обслуживает корень)
    return res.json({ ok: true, file: `/${outFile}` });
  } catch (e) {
    console.error("[context/merge] error:", e && e.message ? e.message : e);
    return res.status(500).send("merge_error");
  }
});

/**
 * GET /context/whisper?session=...&langPair=...
 * - Отправляет `${session}_merged.wav` в Whisper (OpenAI) и возвращает { text, detectedLang }
 * - Требуется OPENAI_API_KEY в env (модули должны проверять это)
 */
router.get("/whisper", async (req, res) => {
  try {
    const session = String(req.query.session || "");
    const langPair = String(req.query.langPair || "");
    if (!session) return res.status(400).send("no session");

    const filePath = path.join(CHUNKS_DIR, `${session}_merged.wav`);
    if (!fs.existsSync(filePath)) return res.status(404).send("no merged file");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

    // prepare form-data
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("task", "transcribe");

    // use global fetch if available (Node18+) or fall back to node-fetch
    const fetchImpl = global.fetch ? global.fetch : (await import("node-fetch")).default;
    const r = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form
    });
    const data = await r.json();

    const text = data.text || "";
    let detectedLang = data.language || null;

    // Optional: if detectedLang seems wrong relative to langPair, ask GPT for correction.
    if (langPair && (!detectedLang || !langPair.split("-").includes(detectedLang))) {
      const [a,b] = langPair.split("-");
      try {
        const prompt = `Text: """${text}"""\nDecide which of these two languages it is written in: ${a} or ${b}. Return only one code (${a} or ${b}).`;
        const checkR = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] })
        });
        const checkJson = await checkR.json();
        const corrected = checkJson.choices?.[0]?.message?.content?.trim().toLowerCase();
        if (corrected && [a,b].includes(corrected)) detectedLang = corrected;
      } catch (e) { /* ignore correction errors */ }
    }

    return res.json({ text, detectedLang });
  } catch (e) {
    console.error("[context/whisper] error:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "whisper_error", message: e && e.message ? e.message : String(e) });
  }
});

/**
 * POST /context/gpt
 * - body: { text, mode, langPair, detectedLang }
 * - forward prompt to GPT (OpenAI) and return { text }
 */
router.post("/gpt", express.json(), async (req, res) => {
  try {
    const { text, mode, langPair, detectedLang } = req.body || {};
    if (!text) return res.status(400).send("no text");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

    let prompt = text;
    if (mode === "translate" && langPair) {
      const [a,b] = langPair.split("-");
      const from = (detectedLang && [a,b].includes(detectedLang)) ? detectedLang : a;
      const to = from === a ? b : a;
      prompt = `Translate from ${from.toUpperCase()} to ${to.toUpperCase()}: ${text}`;
    } else if (mode === "assistant") {
      prompt = `Act as a helpful assistant. Reply naturally: ${text}`;
    }

    const fetchImpl = global.fetch ? global.fetch : (await import("node-fetch")).default;
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] })
    });
    const data = await r.json();
    const out = data.choices?.[0]?.message?.content ?? "";

    return res.json({ text: out });
  } catch (e) {
    console.error("[context/gpt] error:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "gpt_error", message: e && e.message ? e.message : String(e) });
  }
});

/**
 * GET /context/tts?session=&voice=&text=
 * - sends text to TTS model (OpenAI) and saves result as `${session}_tts.<ext>` in CHUNKS_DIR
 */
router.get("/tts", async (req, res) => {
  try {
    const text = String(req.query.text || "");
    const session = String(req.query.session || `sess-${Date.now()}`);
    const voice = String(req.query.voice || "alloy");

    if (!text) return res.status(400).send("no text");
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

    const fetchImpl = global.fetch ? global.fetch : (await import("node-fetch")).default;
    const r = await fetchImpl("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text })
    });
    const audio = await r.arrayBuffer();
    const file = `${session}_tts.mp3`;
    fs.writeFileSync(path.join(CHUNKS_DIR, file), Buffer.from(audio));
    return res.json({ url: `/${file}` });
  } catch (e) {
    console.error("[context/tts] error:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "tts_error", message: e && e.message ? e.message : String(e) });
  }
});

// === WebSocket attachment (optional) ===
// Если главный server.js вызовет init(app, server), модуль поднимет ws на path `${prefix}/ws`.
// WS принимает мета в виде JSON string (type: "meta") и бинарные чанки (Float32Array.buffer).
export function init(app, server) {
  if (!server) {
    console.log("[context] init: server not provided, skipping WS attach");
    return;
  }

  const wss = new WebSocketServer({ server, path: `${prefix}/ws` });
  let counter = 1;

  wss.on("connection", (ws) => {
    ws.sessionId = `sess-${counter++}`;
    ws.sampleRate = 44100;
    ws.chunkCounter = 0;
    ws.send(`SESSION:${ws.sessionId}`);

    ws.on("message", (data) => {
      // string messages are meta: { type: "meta", sampleRate }
      if (typeof data === "string") {
        try {
          const meta = JSON.parse(data);
          if (meta.type === "meta") {
            ws.sampleRate = meta.sampleRate || ws.sampleRate;
            return ws.send(`META_OK:${ws.sampleRate}`);
          }
        } catch (e) { /* ignore parse errors */ }
        return;
      }

      // binary -> Float32 -> save as wav chunk
      try {
        const buf = Buffer.from(data);
        const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
        const wav = floatToWav(f32, ws.sampleRate);
        const filename = `${ws.sessionId}_chunk_${ws.chunkCounter++}.wav`;
        fs.writeFileSync(path.join(CHUNKS_DIR, filename), wav);
        ws.send(`SAVED:${filename}`);
      } catch (e) {
        console.error("[context/ws] save error:", e && e.message ? e.message : e);
      }
    });

    ws.on("close", () => console.log(`[context/ws] closed ${ws.sessionId}`));
  });

  console.log(`[context] WebSocket attached at ${prefix}/ws`);
}
