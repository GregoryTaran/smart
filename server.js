import fs from "fs";
import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.BASE_URL || "https://test.smartvision.life";

const app = express();
app.use(express.json());
app.use(express.static("."));

const server = app.listen(PORT, () => console.log(`🚀 Server started on ${PORT}`));
const wss = new WebSocketServer({ server });

let sessionCounter = 1;

// === WebSocket ===
wss.on("connection", (ws) => {
  ws.sampleRate = 44100;
  ws.sessionId = `sess-${sessionCounter++}`;
  ws.chunkCounter = 0;
  ws.send(`SESSION:${ws.sessionId}`);
  console.log(`🎧 New connection: ${ws.sessionId}`);

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
      fs.writeFileSync(filename, wav);
      ws.send(`💾 Saved ${filename}`);
    }
  });

  ws.on("close", () => console.log(`❌ Closed ${ws.sessionId}`));
});

// === Merge ===
app.get("/merge", (req, res) => {
  try {
    const session = req.query.session;
    if (!session) return res.status(400).send("No session");

    const files = fs.readdirSync(".")
      .filter(f => f.startsWith(`${session}_chunk_`))
      .sort((a, b) => +a.match(/chunk_(\d+)/)[1] - +b.match(/chunk_(\d+)/)[1]);

    if (!files.length) return res.status(404).send("No chunks");

    const headerSize = 44;
    const first = fs.readFileSync(files[0]);
    const sr = first.readUInt32LE(24);
    const pcms = files.map(f => fs.readFileSync(f).subarray(headerSize));
    const totalPCM = Buffer.concat(pcms);
    const merged = makeWav(totalPCM, sr);
    const outFile = `${session}_merged.wav`;
    fs.writeFileSync(outFile, merged);
    console.log(`🧩 Merged ${outFile}`);
    res.json({ ok: true, file: `${BASE_URL}/${outFile}` });
  } catch (err) {
    console.error("❌ Merge error:", err);
    res.status(500).send("Merge error");
  }
});

// === Whisper ===
app.get("/whisper", async (req, res) => {
  try {
    const session = req.query.session;
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
    const file = `${session}_merged.wav`;
    if (!fs.existsSync(file)) return res.status(404).send("No file");

    const form = new FormData();
    form.append("file", fs.createReadStream(file));
    form.append("model", "whisper-1");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Whisper error");
    console.log("🧠 Whisper →", data.text);
    res.json({ text: data.text });
  } catch (e) {
    console.error("❌ Whisper error:", e);
    res.status(500).json({ error: e.message });
  }
});

// === GPT ===
app.post("/gpt", async (req, res) => {
  try {
    const { text, mode, langPair } = req.body || {};
    if (!text) return res.status(400).send("No text");

    let prompt = text;
    if (mode === "translate") {
      const [from, to] = (langPair || "en-ru").split("-");
      prompt = `Translate from ${from.toUpperCase()} to ${to.toUpperCase()}: ${text}`;
    } else if (mode === "assistant") {
      prompt = `Act as a helpful assistant. Reply naturally: ${text}`;
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "GPT error");
    const reply = data.choices?.[0]?.message?.content?.trim() || "";
    console.log("🤖 GPT →", reply);
    res.json({ text: reply });
  } catch (e) {
    console.error("❌ GPT error:", e);
    res.status(500).json({ error: e.message });
  }
});

// === TTS (OpenAI Speech) ===
app.get("/tts", async (req, res) => {
  try {
    const text = req.query.text || "";
    const session = req.query.session || "tts";
    const voice = req.query.voice || "alloy";
    if (!text) return res.status(400).send("No text");
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text
      })
    });

    if (!r.ok) throw new Error("TTS error: " + (await r.text()));

    const audio = await r.arrayBuffer();
    const file = `${session}_tts.mp3`;
    fs.writeFileSync(file, Buffer.from(audio));
    const url = `${BASE_URL}/${file}`;
    console.log(`🔊 TTS ready: ${url}`);
    res.json({ url });
  } catch (e) {
    console.error("❌ TTS error:", e);
    res.status(500).json({ error: e.message });
  }
});

// === Helpers ===
function floatToWav(f32, sampleRate = 44100) {
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
