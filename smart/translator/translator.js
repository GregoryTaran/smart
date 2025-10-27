export async function renderTranslator(mount) {
  let customSessionId = sessionStorage.getItem("user-sess");

  if (!customSessionId) {
    customSessionId = "user-sess-" + new Date().toISOString().split('T')[0] + '-' + Math.floor(Math.random() * 1000);
    sessionStorage.setItem("user-sess", customSessionId);  // Сохраняем в sessionStorage
  }

  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
      <p id="session-id-display" style="text-align:center; font-weight: bold;">Сессия ID: ${customSessionId}</p>
      <h2>🎙️ Переводчик — Суфлёр</h2>
      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">🧑 Голос озвучки:</label>
        <select id="voice-select">
          <option value="alloy">Alloy (универсальный)</option>
          <option value="verse">Verse (бархатный мужской)</option>
          <option value="echo">Echo (низкий тембр)</option>
        </select>
      </div>
      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">Языковая пара:</label>
        <select id="lang-pair">
          <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
          <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
          <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
          <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
        </select>
      </div>
      <div style="text-align:center;margin-bottom:10px;">
        <button id="translator-record-btn">Start</button>
        <button id="ctx-stop" style="background:#f44336;" disabled>Stop</button>
      </div>
      <div id="ctx-log" style="min-height:300px;overflow:auto;">
        <!-- Лог сессии будет отображаться здесь -->
      </div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const voiceSel = mount.querySelector("#voice-select");
  const langSel = mount.querySelector("#lang-pair");

  let ws, audioCtx, stream;
  const WS_URL = location.protocol === "https:" ? "wss://" + location.host : "ws://" + location.host;

  function log(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;  // Прокручиваем до конца
  }

  // Отправка на сервер сессии ID
  function sendSessionIdToServer(sessionId) {
    log("✅ Session ID sent to server: " + sessionId);
    ws.send(JSON.stringify({ type: "register", session: sessionId }));
  }

  // Логируем customSessionId на странице
  log("Сессия ID: " + customSessionId);

  // 1. Зарегистрируем AudioWorkletProcessor
  class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.port.onmessage = (event) => {
        // Обработчик для получения данных
        this.port.postMessage(event.data);  // Отправляем данные обратно
      };
    }

    process(inputs, outputs, parameters) {
      // Здесь можно обрабатывать аудио данные
      return true;
    }
  }

  // Регистрация обработчика (важно, чтобы это было до создания AudioWorkletNode)
  if (!window.AudioWorkletProcessor) {
    log("❌ AudioWorkletProcessor не доступен.");
    return;
  }

  registerProcessor('recorder-processor', RecorderProcessor);

  btnStart.onclick = async () => {
    try {
      const voice = voiceSel.value;
      const langPair = langSel.value;

      // Создание WebSocket-соединения
      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      ws.onmessage = (e) => {
        const msg = String(e.data);
        log("📩 Сообщение от сервера: " + msg);
        if (msg.startsWith("SESSION:")) {
          customSessionId = msg.split(":")[1];  // Получаем обновлённый sessionId с буквой "a"
          document.getElementById("session-id-display").textContent = `Сессия ID: ${customSessionId}`; // Обновляем UI
          log(`✅ Session ID received from server: ${customSessionId}`);
        }
      };

      ws.onopen = () => {
        log("✅ WebSocket connection opened");
        sendSessionIdToServer(customSessionId); // Отправляем сессию на сервер после установления соединения
        ws.send(JSON.stringify({ type: "ping-init" })); // Исправлено: отправляем как JSON
      };

      ws.onclose = () => log("❌ WebSocket connection closed");

      ws.onerror = (error) => {
        log(`⚠️ WebSocket ошибка: ${error.message}`);
        console.error(`WebSocket ошибка: ${error.message}`);
      };

      // Регистрация worklet перед его использованием
      audioCtx = new AudioContext();

      // Получаем поток аудио с микрофона
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Создаём AudioWorkletNode
      const worklet = new AudioWorkletNode(audioCtx, "recorder-processor");
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(worklet);

      // Обработка и отправка аудио чанков через WebSocket
      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk.buffer);  // Отправляем как ArrayBuffer
        }
      };

      btnStart.disabled = true;
      btnStop.disabled = false;
      log("🎙️ Recording started");
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

  btnStop.onclick = async () => {
    try {
      if (audioCtx) audioCtx.close();
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      log("⏹️ Recording stopped");
      btnStart.disabled = false;
      btnStop.disabled = true;

      if (customSessionId) {
        log(`🎧 Finished session: ${customSessionId}`);
      }
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };
}
