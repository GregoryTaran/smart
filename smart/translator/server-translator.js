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

// === Пороги для анализа тишины ===
const SILENCE_THRESHOLD = 0.01; // Порог для амплитуды, ниже которого считаем тишиной

// Функция для анализа тишины в чанк данных
function isSilence(chunk) {
  let totalAmplitude = 0;
  let sampleCount = chunk.length; // Теперь анализируем все сэмплы чанка (1 секунда)

  // Проходим по всем сэмплам чанка и суммируем амплитуду
  for (let i = 0; i < sampleCount; i++) {
    totalAmplitude += Math.abs(chunk[i]); // Суммируем абсолютные значения амплитуды
  }

  // Вычисляем среднюю амплитуду
  const averageAmplitude = totalAmplitude / sampleCount;

  // Логируем амплитуду чанка для отладки
  console.log(`Амплитуда чанка: ${averageAmplitude}`);

  // Если средняя амплитуда ниже порога, считаем чанк тишиной
  return averageAmplitude < SILENCE_THRESHOLD;
}

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
      } catch {}
    } else {
      const buf = Buffer.from(data);
      const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

      // Логируем размер чанка и первые 10 сэмплов для диагностики
      console.log(`📥 Получен чанк размером: ${f32.length} сэмплов`);
      console.log(`Первые 10 сэмплов чанка:`, f32.slice(0, 10));

      // Логируем амплитуду для диагностики
      let totalAmplitude = 0;
      for (let i = 0; i < f32.length; i++) {
        totalAmplitude += Math.abs(f32[i]);
      }
      const averageAmplitude = totalAmplitude / f32.length;
      console.log(`📊 Амплитуда чанка: ${averageAmplitude}`);

      // Анализируем чанк на тишину ДО сохранения
      let chunkDescription;
      if (isSilence(f32)) {
        chunkDescription = "пустой";  // Помечаем как "пустой", если чанк - тишина
      } else if (averageAmplitude > SILENCE_THRESHOLD) {
        chunkDescription = "громкий";  // Помечаем как "громкий", если чанк содержит звук
      } else {
        chunkDescription = "не понятно"; // Если амплитуда не подходит, выводим "не понятно"
      }

      // Логируем, какой чанк был определён
      console.log(`🎧 Чанк ${chunkDescription}`);

      // Дополнительная информация о чанке для логирования
      const chunkSize = f32.length;
      console.log(`Размер чанка: ${chunkSize} сэмплов | Средняя амплитуда: ${averageAmplitude}`);

      const wav = floatToWav(f32, ws.sampleRate);
      const filename = `${ws.sessionId}_chunk_${ws.chunkCounter++}.wav`;
      fs.writeFileSync(filename, wav);

      // Логируем сохранение чанка с пометкой громкости/тишины
      console.log(`📩 💾 Saved ${filename} — ${chunkDescription}`);

      // Отправляем информацию о чанке на клиент через WebSocket с добавлением "ТЕСТ" отдельно
      const message = `💾 Saved ${filename} — ${chunkDescription} | Размер чанка: ${chunkSize} сэмплов | Средняя амплитуда: ${averageAmplitude}`;
      console.log(`Отправка сообщения на клиент: ${message} ТЕСТ`);  // Log before sending
      ws.send(`${message} ТЕСТ`);  // Send the message to the client with "ТЕСТ" added separately
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
    res.json({ ok: true, file: `${BASE_URL}/${outFile}` });
  } catch (err) {
    console.error(`❌ Merge error: ${err.message}`);
    res.status(500).send(`Merge error: ${err.message}`);
  }
});

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

    // Добавляем слово "ХОРОШО" после завершения
    const message = "ХОРОШО";
    console.log(`Отправка на клиент: ${message}`);
    ws.send(message); // Отправляем "ХОРОШО" на клиент
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
