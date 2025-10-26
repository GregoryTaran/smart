import fs from "fs";
import path from "path";
import { floatToWav } from "./floatToWav"; // Заменить на свой путь, если нужно
const TMP_DIR = path.join("smart", "translator", "tmp"); // Путь для временных файлов

// Логирование с уровнями и временными метками
function logToFile(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  fs.appendFileSync("server.log", logMessage);
  console.log(logMessage);  // Логируем в консоль для отладки
}

// Основная функция для обработки бинарных данных
export async function handleBinaryData(ws, data) {
  try {
    // Логируем получение бинарных данных
    logToFile(`📩 Binary data received for session ${ws.sessionId}, length: ${data.length}`, "INFO");

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    // Проверка на пустой буфер
    if (!buf.length) {
      ws.send("⚠️ Empty binary chunk skipped");
      logToFile(`⚠️ Empty binary chunk skipped for session ${ws.sessionId}`, "WARN");
      return;
    }

    // Логируем размер буфера
    console.log(`🎧 Buffer received: ${buf.length} bytes`);

    // Выравнивание смещения, чтобы оно было кратно 4
    const offset = buf.byteOffset % 4 === 0 ? buf.byteOffset : buf.byteOffset + (4 - buf.byteOffset % 4);

    // Конвертируем буфер в Float32Array
    const f32 = new Float32Array(buf.buffer, offset, Math.floor(buf.byteLength / 4));
    console.log(`🎧 Converted to Float32Array: ${f32.length} samples`);

    // Конвертируем в WAV формат
    const wav = floatToWav(f32, ws.sampleRate || 44100);
    const filename = `${ws.sessionId}_chunk_${ws.chunkCounter || 0}.wav`;
    ws.chunkCounter = (ws.chunkCounter || 0) + 1;

    // Путь для сохранения файла
    const filePath = path.join(TMP_DIR, filename);
    console.log(`🎧 Saving to: ${filePath}`);

    // Сохраняем WAV файл
    fs.writeFileSync(filePath, wav);
    logToFile(`💾 Saved ${filename}`, "INFO");
    ws.send(`💾 Saved ${filename}`);
  } catch (err) {
    // Логируем ошибку
    logToFile(`❌ Binary handler error: ${err.message}`, "ERROR");
    console.error("❌ Binary handler error:", err);
    ws.send("❌ Binary handler crashed: " + err.message);
  }
}

// Функция для обработки регистрации модуля
export function handleRegister(ws, data, sessionCounter) {
  try {
    // Проверка на корректные данные регистрации
    if (!data || !data.module) {
      ws.send("❌ Missing module in registration data");
      logToFile(`❌ Missing module in registration for session ${ws.sessionId}`, "ERROR");
      return;
    }

    // Регистрация модуля и создание уникального sessionId
    ws.module = data.module;
    ws.sampleRate = data.sampleRate || 44100;
    ws.sessionId = `${ws.module}-${sessionCounter}`;
    
    // Логируем успешную регистрацию
    ws.send(`SESSION:${ws.sessionId}`);
    logToFile(`✅ Registered module: ${ws.module}, Session ID: ${ws.sessionId}`, "INFO");
  } catch (err) {
    // Логируем ошибку регистрации
    logToFile(`❌ Registration error for session ${ws.sessionId}: ${err.message}`, "ERROR");
    ws.send("❌ Error during registration");
  }
}

// Дополнительная логика для обработки ошибок и других задач
export function handleError(ws, error) {
  logToFile(`❌ Error in session ${ws.sessionId}: ${error.message}`, "ERROR");
  ws.send("❌ Error: " + error.message);
}
