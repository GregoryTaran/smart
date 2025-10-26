export async function renderTranslator(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
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

      <div id="session-info" style="text-align:center;font-weight:600;color:#4caf50;margin-top:10px;">
        Custom Session ID: <span id="session-id-display"></span> <!-- Место для customSessionId -->
      </div>

      <div id="ctx-log" style="min-height:300px;overflow:auto;">
        <div id="session-id" style="font-weight:600;color:#4caf50;"></div> <!-- Место для customSessionId в логе -->
      </div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const sessionInfoEl = mount.querySelector("#session-info");
  const sessionIdDisplay = mount.querySelector("#session-id-display"); // Место для вывода customSessionId под кнопкой Start
  const sessionIdEl = mount.querySelector("#session-id"); // Место для вывода customSessionId в логе
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const voiceSel = mount.querySelector("#voice-select");
  const langSel = mount.querySelector("#lang-pair");

  let ws, audioCtx, stream, customSessionId = null;

  const WS_URL = location.protocol === "https:" ? "wss://" + location.host : "ws://" + location.host;

  function log(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Проверка и создание customSessionId
  function createSession() {
    customSessionId = localStorage.getItem("customSessionId");
    console.log("Checking sessionId in localStorage:", customSessionId); // Логируем, что у нас есть в localStorage
    if (!customSessionId) {
      customSessionId = "sess-" + Date.now();  // Генерация уникального customSessionId
      localStorage.setItem("customSessionId", customSessionId);  // Сохраняем customSessionId в localStorage
      console.log("New sessionId generated:", customSessionId); // Логируем, что мы создали новый sessionId
    }

    // Логируем customSessionId в консоль
    console.log("Custom Session ID:", customSessionId);

    // Отображаем customSessionId на странице
    sessionIdDisplay.textContent = customSessionId;  // Выводим sessionId под кнопкой Start
    sessionIdEl.textContent = `Custom Session ID: ${customSessionId}`;  // Выводим sessionId в логе
  }

  // Проверяем наличие customSessionId при загрузке страницы
  function checkSession() {
    const storedCustomSessionId = localStorage.getItem("customSessionId");
    console.log("Session ID from localStorage:", storedCustomSessionId); // Логируем, что мы получили из localStorage
    if (storedCustomSessionId) {
      customSessionId = storedCustomSessionId;  // Если сессия существует, используем ее
      sessionIdDisplay.textContent = customSessionId;
      sessionIdEl.textContent = `Custom Session ID: ${customSessionId}`;
      log("📩 Возобновлена сессия: " + customSessionId);
    } else {
      createSession(); // Если сессия не существует, создаем новую
    }
  }

  // Проверка сессии при загрузке страницы
  window.onload = () => {
    checkSession();  // Проверка сессии сразу при загрузке страницы
  };

  // Завершение сессии
  function finalizeSession() {
    localStorage.removeItem("customSessionId");  // Удаляем customSessionId из localStorage при завершении
    sessionIdDisplay.textContent = "";  // Очищаем отображение sessionId под кнопкой Start
    sessionIdEl.textContent = "";  // Очищаем отображение sessionId в логе
    log(`Сессия ${customSessionId} завершена`);
  }

  // Обработчик события закрытия страницы
  window.onbeforeunload = () => {
    finalizeSession();  // Завершаем сессию при закрытии вкладки
  };

  btnStart.onclick = async () => {
    try {
      const voice = voiceSel.value;
      const langPair = langSel.value;

      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) {
          customSessionId = msg.split(":")[1];
          log("📩 " + msg);
        } else {
          log(msg);
        }
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "register", voice, langPair }));
        ws.send("ping-init");
        log("✅ Connected to WebSocket");
      };

      ws.onclose = () => log("❌ Disconnected");

      audioCtx = new AudioContext();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "recorder-processor");

      source.connect(worklet);
      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        if (ws.readyState === WebSocket.OPEN) {
          addAudioChunk(chunk);  // Добавляем чанк в сессию
          ws.send(chunk.buffer);
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
        await processSession();
        finalizeSession();  // Завершаем сессию
      }
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

  async function processSession() {
    try {
      const voice = voiceSel.value;
      const langPair = langSel.value;

      log("🧩 Объединяем чанки...");
      await fetch(`/translator/merge?session=${customSessionId}`);
      log("💾 merged");

      log("🧠 Whisper...");
      const w = await fetch(`/translator/whisper?session=${customSessionId}&langPair=${encodeURIComponent(langPair)}`);
      const data = await w.json();
      const text = data.text || "";
      const detectedLang = data.detectedLang || null;
      log("🧠 → " + text);
      log("🌐 Detected language: " + (detectedLang || "none"));

      let finalText = text;
      log("🤖 GPT...");
      const body = { text, mode: "translate", langPair, detectedLang };
      const g = await fetch("/translator/gpt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const gData = await g.json();
      finalText = gData.text;
      log("🤖 → " + finalText);

      if (finalText) {
        log("🔊 TTS...");
        const t = await fetch(`/translator/tts?session=${customSessionId}&voice=${voice}&text=${encodeURIComponent(finalText)}`);
        const tData = await t.json();
        log(`🔊 ${tData.url}`);
        const audio = new Audio(tData.url);
        audio.play();
      }
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  }
}
