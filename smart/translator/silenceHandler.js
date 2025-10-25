// silenceHandler.js

let silenceTimer = null;  // Таймер для отслеживания молчания
let buffer = [];
let lastSend = Date.now();

// Эта функция будет отслеживать тишину и отправлять сигнал на сервер
export function checkSilence(chunk, ws, processSession) {
  const level = rms(chunk);  // Вычисляем уровень громкости

  if (level < 0.01) { // Если уровень слишком низкий (тишина)
    if (!silenceTimer) {
      silenceTimer = setTimeout(() => {
        // Детекция тишины, запускаем обработку
        log("🤫 Detected silence — sending signal to server");
        sendBlock(ws);
        processSession();  // Запуск процесса обработки (например, Whisper, GPT)
        silenceTimer = null; // Сброс таймера
      }, 2000); // Ожидаем 2 секунды молчания
    }
  } else {
    if (silenceTimer) {
      clearTimeout(silenceTimer);  // Если появился звук, сбрасываем таймер
      silenceTimer = null;
    }
  }

  const now = Date.now();
  if (now - lastSend >= 1000) { // Проверяем, прошло ли 1000 миллисекунд (1 секунда)
    sendBlock(ws);
    lastSend = now; // Обновляем время последней отправки
  }
}

// Функция для вычисления RMS (уровня громкости)
function rms(chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) {
    sum += chunk[i] * chunk[i];
  }
  return Math.sqrt(sum / chunk.length);
}

// Отправка блока данных на сервер
function sendBlock(ws) {
  if (!buffer.length || !ws || ws.readyState !== WebSocket.OPEN) return;
  const full = concat(buffer);
  ws.send(full.buffer);
  buffer = []; // Очищаем буфер после отправки
  log(`🎧 Sent ${full.length} samples`);
}

// Функция для объединения чанков
function concat(chunks) {
  const total = chunks.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Логирование
function log(msg) {
  console.log(msg);
}
