export async function renderTranslator(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎙️ Переводчик — Суфлёр</h2>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">🧑 Голос озвучки:</label>
        <select id="voice-select" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="alloy">Alloy (универсальный)</option>
          <option value="verse">Verse (бархатный мужской)</option>
          <option value="echo">Echo (низкий тембр)</option>
          <option value="breeze">Breeze (лёгкий мужской)</option>
          <option value="coral">Coral (мягкий мужской)</option>
          <option value="astra">Astra (женский)</option>
        </select>
      </div>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">Режим обработки:</label>
        <select id="process-mode" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="recognize">🎧 Только распознавание</option>
          <option value="translate">🔤 Перевод через GPT</option>
          <option value="assistant">🤖 Ответ ассистента</option>
        </select>
      </div>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">Языковая пара:</label>
        <select id="lang-pair" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
          <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
          <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
          <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
        </select>
      </div>

      <div style="text-align:center;margin-bottom:10px;">
        <button id="translator-record-btn">Start</button>
        <button id="ctx-stop" style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>

      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  document.addEventListener('DOMContentLoaded', () => {
    const btnStart = mount.querySelector("#translator-record-btn");
    const btnStop = mount.querySelector("#ctx-stop");

    let silenceTimer = null;
    let buffer = [];
    let lastSend = Date.now();
    let ws;
    
    // Функция для вычисления RMS (уровня громкости)
    function rms(chunk) {
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) {
        sum += chunk[i] * chunk[i];
      }
      return Math.sqrt(sum / chunk.length);
    }

    // Проверка тишины
    function checkSilence(chunk, processSession) {
      const level = rms(chunk);

      if (level < 0.01) { // Если уровень слишком низкий (тишина)
        if (!silenceTimer) {
          silenceTimer = setTimeout(() => {
            console.log("🤫 Detected silence — sending signal to server");
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

    // Отправка блока данных на сервер
    function sendBlock(ws) {
      if (!buffer.length || !ws || ws.readyState !== WebSocket.OPEN) return;
      const full = concat(buffer);
      ws.send(full.buffer);
      buffer = []; // Очищаем буфер после отправки
      console.log(`🎧 Sent ${full.length} samples`);
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

    // Обработчик кнопки Start
    btnStart.onclick = async () => {
      try {
        const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
        ws = new WebSocket(WS_URL);
        ws.binaryType = "arraybuffer";
        ws.onmessage = (e) => {
          const msg = String(e.data);
          console.log("📩 " + msg);
        };

        ws.onclose = () => console.log("❌ Disconnected");

        ws.onopen = () => {
          console.log("✅ Connected to WebSocket");
          // Здесь можно отправить данные или начать запись
        };

        btnStart.disabled = true;
        btnStop.disabled = false;
        console.log("🎙️ Recording started");

      } catch (e) {
        console.log("❌ Ошибка: " + e.message);
      }
    };

    // Обработчик кнопки Stop
    btnStop.onclick = async () => {
      try {
        sendBlock(ws);
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        btnStart.disabled = false;
        btnStop.disabled = true;
        console.log("⏹️ Recording stopped");
      } catch (e) {
        console.log("❌ Ошибка: " + e.message);
      }
    };
  });
}
