import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { logToFile } from './utils.js';  // Для логирования

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;  // Получаем ключ API для OpenAI

/**
 * Функция для конвертации Float32Array в WAV
 * @param {Float32Array} audioData - Данные аудиофрейма
 * @param {number} sampleRate - Частота дискретизации
 * @returns {Buffer} - Буфер WAV
 */
function floatToWav(audioData, sampleRate) {
  const buffer = Buffer.alloc(audioData.length * 2);
  for (let i = 0; i < audioData.length; i++) {
    buffer.writeInt16LE(audioData[i] * 32767, i * 2);  // Преобразуем в 16-битные значения
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buffer.length, 4);  // Общий размер
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);  // Размер формата
  header.writeUInt16LE(1, 20);  // PCM
  header.writeUInt16LE(1, 22);  // Один канал (моно)
  header.writeUInt32LE(sampleRate, 24);  // Частота дискретизации
  header.writeUInt32LE(sampleRate * 2, 28);  // byte rate
  header.writeUInt16LE(2, 32);  // block align
  header.writeUInt16LE(16, 34);  // битовая глубина
  header.write('data', 36);
  header.writeUInt32LE(buffer.length, 40);  // Размер данных

  return Buffer.concat([header, buffer]);
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

    // Собираем все чанки в один массив
    const fullBuffer = Buffer.concat(chunks.map(chunk => floatToWav(chunk, sampleRate)));

    // Сохраняем файл
    const filename = `${sessionId}_merged.wav`;
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
 * @param {string} langPair - Языковая пара
 * @param {string} detectedLang - Обнаруженный язык
 * @returns {string} - Ответ от GPT
 */
export async function processGPT(text, langPair, detectedLang) {
  try {
    const [a, b] = langPair.split("-");
    let prompt = text;

    let from = detectedLang || a;
    const to = from === a ? b : a;
    prompt = `Translate from ${from.toUpperCase()} to ${to.toUpperCase()}: ${text}`;

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

// Основная функция, которая будет вызываться из server.js
export async function processAudioAndText({ sessionId, audioData, langPair, voice, sampleRate }) {
  try {
    // Пример обработки аудио:
    const filename = await processChunks(sessionId, [audioData], sampleRate);  // Генерация WAV

    // Отправка на Whisper для транскрипции
    const whisperResult = await processWhisper(sessionId, langPair);

    // Отправка текста в GPT для обработки
    const gptResult = await processGPT(whisperResult.text, langPair, whisperResult.detectedLang);

    // Генерация речи через TTS
    const ttsResult = await processTTS(gptResult, sessionId, voice);

    // Возвращаем результат в виде объектов
    return {
      text: gptResult,
      ttsUrl: ttsResult
    };

  } catch (error) {
    console.error("Ошибка при обработке данных:", error.message);
    return null;
  }
}
