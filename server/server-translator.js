import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { logToFile } from './utils.js';  // Импортируем logToFile из utils.js для логирования в файл

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;  // Получаем ключ API для OpenAI

/**
 * Функция для добавления буквы "a" к ID сессии
 * @param {string} sessionId - Изначальный ID сессии
 * @returns {string} - Обновлённый ID сессии с добавленной буквой "a"
 */
export function handleSessionRegistration(sessionId) {
  const updatedSessionId = sessionId + "a";  // Просто добавляем "a" к строке sessionId

  // Логируем добавление буквы "a" к sessionId (для отладки и мониторинга)
  console.log(`✅ Обработана сессия: "${updatedSessionId}"`);  // Логируем обновлённый ID в консоль
  logToFile(`✅ Обработана сессия: "${updatedSessionId}"`);  // Логируем в файл

  // Возвращаем обновлённый sessionId
  return updatedSessionId;
}

/**
 * Обработка получения чанков и создание WAV
 * @param {string} sessionId - Идентификатор сессии
 * @param {Float32Array[]} chunks - Массив аудио-чанков
 * @param {number} sampleRate - Частота дискретизации
 * @returns {string} - Путь к сохранённому файлу
 */
export function processChunks(sessionId, chunks, sampleRate) {
  try {
    if (!chunks || chunks.length === 0) {
      logToFile(`⚠️ Нет данных для обработки в сессии: ${sessionId}`);
      return null;
    }

    const filename = `${sessionId}_merged.wav`;
    const fullBuffer = Buffer.concat(chunks.map(chunk => floatToWav(chunk, sampleRate)));

    fs.writeFileSync(filename, fullBuffer);
    logToFile(`💾 Сохранён файл: ${filename}`);
    return filename;
  } catch (error) {
    logToFile(`❌ Ошибка при обработке чанков для сессии: ${sessionId}, ошибка: ${error.message}`);
    console.error(`❌ Ошибка при обработке чанков для сессии: ${sessionId}, ошибка: ${error.message}`);
    return null;
  }
}

/**
 * Функция для отправки файла на Whisper для транскрипции
 * @param {string} sessionId - Идентификатор сессии
 * @param {string} langPair - Языковая пара
 */
export async function processWhisper(sessionId, langPair) {
  try {
    const filePath = `${sessionId}_merged.wav`; // Путь к созданному WAV файлу
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('task', 'transcribe');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: form
    });

    const data = await response.json();
    console.log('Whisper response:', data);
    logToFile(`Whisper response: ${JSON.stringify(data)}`);
    
    // Обработка текста из Whisper
    const text = data.text || '';
    const detectedLang = data.language || null;
    return { text, detectedLang };
  } catch (e) {
    logToFile(`❌ Ошибка при отправке запроса на Whisper для сессии: ${sessionId}, ошибка: ${e.message}`);
    console.error(`❌ Ошибка при отправке запроса на Whisper для сессии: ${sessionId}, ошибка: ${e.message}`);
    return null;
  }
}

/**
 * Функция для отправки текста на GPT
 * @param {string} text - Текст для обработки
 * @param {string} mode - Режим обработки (например, "translate" или "assistant")
 * @param {string} langPair - Языковая пара
 * @param {string} detectedLang - Обнаруженный язык
 * @returns {string} - Ответ от GPT
 */
export async function processGPT(text, mode, langPair, detectedLang) {
  try {
    const [a, b] = langPair.split("-");
    let prompt = text;

    if (mode === "translate") {
      let from = detectedLang || a;
      const to = from === a ? b : a;
      prompt = `Translate from ${from.toUpperCase()} to ${to.toUpperCase()}: ${text}`;
    } else if (mode === "assistant") {
      prompt = `Act as a helpful assistant. Reply naturally: ${text}`;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    logToFile(`❌ Ошибка при отправке запроса на GPT для сессии: ${sessionId}, ошибка: ${e.message}`);
    console.error(`❌ Ошибка при отправке запроса на GPT для сессии: ${sessionId}, ошибка: ${e.message}`);
    return "";
  }
}

/**
 * Функция для генерации речи с помощью TTS
 * @param {string} text - Текст для генерации речи
 * @param {string} sessionId - Идентификатор сессии
 * @param {string} voice - Голос для озвучки
 */
export async function processTTS(text, sessionId, voice = "alloy") {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voice,
        input: text,
      }),
    });

    const audio = await response.arrayBuffer();
    const audioFilePath = `${sessionId}_tts.mp3`;
    fs.writeFileSync(audioFilePath, Buffer.from(audio));
    logToFile(`🔊 Сохранён TTS файл: ${audioFilePath}`);
    return audioFilePath;
  } catch (e) {
    logToFile(`❌ Ошибка при отправке запроса на TTS для сессии: ${sessionId}, ошибка: ${e.message}`);
    console.error(`❌ Ошибка при отправке запроса на TTS для сессии: ${sessionId}, ошибка: ${e.message}`);
    return "";
  }
}
