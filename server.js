import express from "express";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import FormData from "form-data";

const app = express();
const PORT = 10000;  // Порт для основного сервера

app.use(express.json());  // Для обработки JSON

// Конфигурация API ключа OpenAI
const OPENAI_API_KEY = "your-api-key";  // Замени на свой ключ
const BASE_URL = "https://test.smartvision.life";  // URL для доступа к файлам

// === Whisper ===
app.get("/whisper", async (req, res) => {
  try {
    const { session, langPair } = req.query;
    const file = `${session}_merged.wav`;

    // Проверка существования файла
    if (!fs.existsSync(file)) return res.status(404).send("No file");

    const form = new FormData();
    form.append("file", fs.createReadStream(file));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("task", "transcribe");

    // Запрос на транскрипцию
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

    // ——— коррекция языка ———
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

    // Добавляем вывод сообщения после завершения всех операций
    console.log("ВЫ ПРЕКРАСНЫ");
  } catch (e) {
    console.error("❌ Whisper error:", e.message);
    res.status(500).json({ error: e.message, detectedLang: null, text: "" });
  }
});

// === TTS ===
app.get("/tts", async (req, res) => {
  try {
    const { text, session, voice } = req.query;
    if (!text) return res.status(400).send("No text");

    // Запрос на TTS (Text to Speech)
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voice || "alloy",  // Можно указать желаемый голос
        input: text,
      }),
    });

    const audio = await r.arrayBuffer();
    const file = `${session}_tts.mp3`;
    fs.writeFileSync(file, Buffer.from(audio));

    // Возвращаем ссылку на озвученный файл
    res.json({ url: `${BASE_URL}/${file}` });

    // Добавляем вывод сообщения после завершения всех операций
    console.log("ВЫ ПРЕКРАСНЫ");
  } catch (e) {
    console.error("❌ TTS error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Запуск основного сервера
const server = app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
