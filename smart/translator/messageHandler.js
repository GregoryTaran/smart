import fs from "fs";
import path from "path";

// Путь для временных файлов
const TMP_DIR = path.join("smart", "translator", "tmp");

// Логирование данных
function logToFile(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;

  // Запись в файл
  fs.appendFileSync("server.log", logMessage);
  console.log(logMessage);  // Логируем в консоль для отладки
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
