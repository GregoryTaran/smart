import fs from "fs";
import path from "path";

// Путь для временных файлов
const TMP_DIR = path.join("smart", "translator", "tmp");

// Проверка и создание директории, если она не существует
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  console.log(`✔️ TMP_DIR created: ${TMP_DIR}`);
} else {
  console.log(`✔️ TMP_DIR already exists: ${TMP_DIR}`);
}

// Логирование с уровнями и временными метками
function logToFile(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  fs.appendFileSync("server.log", logMessage);
  console.log(logMessage);  // Логируем в консоль для отладки
}

// Преобразование Float32Array в WAV
function floatToWav(f32, sampleRate) {
  const buffer = Buffer.alloc(44 + f32.length * 2);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + f32.length * 2, true); // Chunk size
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk size
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, 1, true); // Number of channels (Mono)
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample (16 bits)

  // data header
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, f32.length * 2, true); // Data chunk size

  // Audio data
  let offset = 44;
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

// Принудительная обработка Float32Array данных
export async function handleBinaryData(ws, data) {
  try {
    logToFile(`📩 Binary data received for session ${ws.sessionId}, length: ${data.length}`, "INFO");

    // Преобразуем данные в буфер
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    // Логируем размер буфера
    logToFile(`🎧 Buffer received: ${buf.length} bytes`, "INFO");

    // Проверка на пустой буфер
    if (!buf.length) {
      ws.send("⚠️ Empty binary chunk skipped");
      logToFile(`⚠️ Empty binary chunk skipped for session ${ws.sessionId}`, "WARN");
      return;
    }

    // Конвертируем буфер в Float32Array
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    logToFile(`🎧 Converted to Float32Array: ${f32.length} samples`, "INFO");

    // Проверка на корректность данных
    if (f32.length < 1) {
      ws.send("⚠️ Invalid data length, chunk discarded.");
      logToFile(`⚠️ Invalid data length for session ${ws.sessionId}`, "WARN");
      return;
    }

    // Логируем перед конвертацией в WAV
    logToFile(`🎧 Preparing WAV conversion for ${f32.length} samples`, "INFO");

    // Преобразуем в WAV
    const wav = floatToWav(f32, ws.sampleRate || 44100);
    const filename = `${ws.sessionId}_chunk_${ws.chunkCounter || 0}.wav`;
    ws.chunkCounter = (ws.chunkCounter || 0) + 1;

    // Путь для сохранения файла
    const filePath = path.join(TMP_DIR, filename);
    logToFile(`🎧 Saving to: ${filePath}`, "INFO");

    // Сохраняем WAV файл
    fs.writeFileSync(filePath, wav);
    logToFile(`💾 Saved ${filename}`, "INFO");
    ws.send(`💾 Saved ${filename}`);
  } catch (err) {
    logToFile(`❌ Binary handler error: ${err.message}`, "ERROR");
    console.error("❌ Binary handler error:", err);
    ws.send("❌ Binary handler crashed: " + err.message);
  }
}

// Экспортируем функции корректно
export { handleBinaryData, floatToWav, logToFile };
