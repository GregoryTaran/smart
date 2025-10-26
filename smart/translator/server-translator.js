import fs from "fs";
import path from "path";

// Путь для временных файлов
const TMP_DIR = path.join("smart", "translator", "tmp");

// Проверка существования директории TMP_DIR и создание при необходимости
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  console.log(`✔️ TMP_DIR created: ${TMP_DIR}`);
} else {
  console.log(`✔️ TMP_DIR already exists: ${TMP_DIR}`);
}

// Логирование данных
function logToFile(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;

  // Запись в файл
  fs.appendFileSync("server.log", logMessage);
  console.log(logMessage); // Логируем в консоль для отладки
}

// Обработка регистрации модуля
export function handleRegister(ws, data, sessionCounter) {
  ws.module = data.module;
  ws.sampleRate = data.sampleRate || 44100;
  ws.sessionId = `${ws.module}-${sessionCounter}`;
  ws.send(`SESSION:${ws.sessionId}`);
  logToFile(`✅ Registered module: ${ws.module}, Session ID: ${ws.sessionId}`);
}

// Обработка бинарных данных
export async function handleBinaryData(ws, data) {
  try {
    logToFile(`📩 Binary data received for session ${ws.sessionId}, length: ${data.length}`, "INFO");

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!buf.length) {
      ws.send("⚠️ Empty binary chunk skipped");
      logToFile(`⚠️ Empty binary chunk skipped for session ${ws.sessionId}`, "WARN");
      return;
    }

    console.log(`🎧 Buffer received: ${buf.length} bytes`);

    const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    console.log(`🎧 Converted to Float32Array: ${f32.length} samples`);

    const wav = floatToWav(f32, ws.sampleRate || 44100);
    const filename = `${ws.sessionId}_chunk_${ws.chunkCounter || 0}.wav`;
    ws.chunkCounter = (ws.chunkCounter || 0) + 1;

    const filePath = path.join(TMP_DIR, filename);
    console.log(`🎧 Saving to: ${filePath}`);

    fs.writeFileSync(filePath, wav);
    logToFile(`💾 Saved ${filename}`, "INFO");
    ws.send(`💾 Saved ${filename}`);
  } catch (err) {
    logToFile(`❌ Binary handler error: ${err.message}`, "ERROR");
    console.error("❌ Binary handler error:", err);
    ws.send("❌ Binary handler crashed: " + err.message);
  }
}

// Обработка метаданных
export function handle(ws, data) {
  if (data.type === "meta") {
    ws.sampleRate = data.sampleRate || 44100;
    ws.langPair = data.langPair || "en-ru";
    ws.processMode = data.processMode || "translate";
    ws.chunkCounter = 0;
    ws.send(`🎛 Meta ok: ${ws.sampleRate} Hz`);
    logToFile(`🎛 Meta received for session ${ws.sessionId}: SampleRate = ${ws.sampleRate} Hz, LangPair = ${ws.langPair}, ProcessMode = ${ws.processMode}`, "INFO");
  }
}

// Конвертация данных в WAV формат
function floatToWav(f32, sampleRate) {
  const buffer = Buffer.alloc(44 + f32.length * 2);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + f32.length * 2, true); // Размер данных
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Размер заголовка
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Моно
  view.setUint32(24, sampleRate, true); // Частота дискретизации
  view.setUint32(28, sampleRate * 2, true); // Битрейт
  view.setUint16(32, 2, true); // Стерео
  view.setUint16(34, 16, true); // Битность
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, f32.length * 2, true); // Размер данных

  let off = 44;
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

// Маршруты API для работы с аудио файлами (merge, whisper, gpt, tts)
export default function registerTranslator(app) {
  logToFile("🔗 Translator module (API) connected.", "INFO");

  // Маршрут для слияния аудио чанков
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

      logToFile(`💾 Merged chunks for session ${session}`, "INFO");
      res.json({ ok: true, file: `${BASE_URL}/smart/translator/tmp/${outFile}` });
    } catch (err) {
      logToFile(`❌ Merge error: ${err.message}`, "ERROR");
      console.error("❌ Merge error:", err);
      res.status(500).send("Merge error");
    }
  });

  // Маршрут для Whisper (транскрипция)
  app.get("/translator/whisper", async (req, res) => {
    try {
      const { session, langPair } = req.query;
      const file = path.join(TMP_DIR, `${session}_merged.wav`);
      if (!fs.existsSync(file)) return res.status(404).send("No file");

      logToFile(`🧠 Whisper: Processing for session ${session}...`, "INFO");

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
      logToFile(`🌐 Whisper result: ${data.text}`, "INFO");
      res.json({ text: data.text || "", detectedLang: data.language || null });
    } catch (err) {
      logToFile(`❌ Whisper error: ${err.message}`, "ERROR");
      console.error("❌ Whisper error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Маршрут для GPT (обработка текста)
  app.post("/translator/gpt", async (req, res) => {
    try {
      const { text, mode, langPair, detectedLang } = req.body;
      if (!text) return res.status(400).send("No text");

      logToFile(`🤖 GPT processing for text: ${text}`, "INFO");

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
      logToFile(`🤖 GPT response: ${data.choices?.[0]?.message?.content ?? ""}`, "INFO");
      res.json({ text: data.choices?.[0]?.message?.content ?? "" });
    } catch (err) {
      logToFile(`❌ GPT error: ${err.message}`, "ERROR");
      console.error("❌ GPT error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Маршрут для TTS (синтез речи)
  app.get("/translator/tts", async (req, res) => {
    try {
      const { text, session, voice } = req.query;
      if (!text) return res.status(400).send("No text");

      logToFile(`🔊 TTS: Processing for session ${session}...`, "INFO");

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

      logToFile(`🔊 TTS saved as: ${file}`, "INFO");
      res.json({ url: `${BASE_URL}/smart/translator/tmp/${file}` });
    } catch (err) {
      logToFile(`❌ TTS error: ${err.message}`, "ERROR");
      console.error("❌ TTS error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

// Конвертация PCM в WAV
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
