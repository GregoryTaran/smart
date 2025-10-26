import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import FormData from "form-data";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.BASE_URL || "https://test.smartvision.life";

export default function registerTranslator(app, wss) {
  console.log("🔗 Translator module connected.");

  const TMP_DIR = path.join("smart", "translator", "tmp");
  fs.mkdirSync(TMP_DIR, { recursive: true });

  let sessionCounter = 1;

  // === ОДИН обработчик подключения ===
  wss.on("connection", (ws) => {
    // --- поддержка активности ---
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));

    // --- инициализация сессии ---
    ws.sampleRate = 44100;
    ws.sessionId = `translator-${sessionCounter++}`;
    ws.chunkCounter = 0;
    ws.send(`SESSION:${ws.sessionId}`);
    console.log(`🎧 Translator WS connected: ${ws.sessionId}`);

    // --- обработка сообщений ---
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
        } catch {}
      } else {
        const buf = Buffer.from(data);
        const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const wav = floatToWav(f32, ws.sampleRate);
        const filename = `${ws.sessionId}_chunk_${ws.chunkCounter++}.wav`;
        fs.writeFileSync(path.join(TMP_DIR, filename), wav);
        ws.send(`💾 Saved ${filename}`);
      }
    });

    ws.on("close", () => console.log(`❌ Translator WS closed: ${ws.sessionId}`));
  });

  // --- пинг таймер ---
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  // === остальные маршруты ===
  app.get("/translator/merge", (req, res) => {
    try {
      const session = req.query.session;
      if (!session) return res.status(400).send("No session");
      const files = fs.readdirSync(TMP_DIR)
        .filter(f => f.startsWith(`${session}_chunk_`))
        .sort((a, b) => +a.match(/chunk_(\d+)/)[1] - +b.match(/chunk_(\d+)/)[1]);
      if (!files.length) return res.status(404).send("No chunks");
      const headerSize = 44;
      const first = fs.readFileSync(path.join(TMP_DIR, files[0]));
      const sr = first.readUInt32LE(24);
      const pcms = files.map(f => fs.readFileSync(path.join(TMP_DIR, f)).subarray(headerSize));
      const totalPCM = Buffer.concat(pcms);
      const merged = makeWav(totalPCM, sr);
      const outFile = `${session}_merged.wav`;
      fs.writeFileSync(path.join(TMP_DIR, outFile), merged);
      res.json({ ok: true, file: `${BASE_URL}/smart/translator/tmp/${outFile}` });
    } catch (err) {
      res.status(500).send("Merge error");
    }
  });

  app.get("/translator/whisper", async (req, res) => {
    try {
      const { session, langPair } = req.query;
      const file = path.join(TMP_DIR, `${session}_merged.wav`);
      if (!fs.existsSync(file)) return res.status(404).send("No file");
      console.log("🧠 Whisper: Processing...");
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
      res.json({ text: data.text || "", detectedLang: data.language || null });
      console.log("🌐 Detected language:", data.language || "none");
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/translator/gpt", async (req, res) => {
    try {
      const { text, mode, langPair, detectedLang } = req.body;
      if (!text) return res.status(400).send("No text");
      let prompt = text;
      if (mode === "translate") {
        const [a, b] = langPair.split("-");
        let from = detectedLang && [a, b].includes(detectedLang) ? detectedLang : a;
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

  app.get("/translator/tts", async (req, res) => {
    try {
      const { text, session, voice } = req.query;
      if (!text) return res.status(400).send("No text");
      console.log("🔊 TTS: Processing...");
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
      fs.writeFileSync(path.join(TMP_DIR, file), Buffer.from(audio));
      res.json({ url: `${BASE_URL}/smart/translator/tmp/${file}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

// === Helpers ===
function floatToWav(f32, sampleRate) {
  const buffer = Buffer.alloc(44 + f32.length * 2);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + f32.length * 2, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, f32.length * 2, true);
  let off = 44;
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

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
