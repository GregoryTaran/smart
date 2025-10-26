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

      <div id="session-info" style="text-align:center;font-weight:600;color:#4caf50;margin-top:10px;"></div> <!-- Место для sessionId под кнопкой -->

      <div id="ctx-log" style="min-height:300px;overflow:auto;">
        <div id="session-id" style="font-weight:600;color:#4caf50;"></div> <!-- Место для sessionId в логе -->
      </div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const sessionInfoEl = mount.querySelector("#session-info"); // Место для вывода sessionId под кнопкой Start
  const sessionIdEl = mount.querySelector("#session-id"); // Место для вывода sessionId в логе
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const voiceSel = mount.querySelector("#voice-select");
  const langSel = mount.querySelector("#lang-pair");

  let ws, audioCtx, stream, sessionId = null;

  const WS_URL = location.protocol === "https:" ? "wss://" + location.host : "ws://" + location.host;

  function log(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Проверяем, есть ли уже сессия в SessionStorage при загрузке страницы
  function checkSession() {
    const storedSessionId = sessionStorage.getItem('sessionId');
    if (storedSessionId) {
      sessionId = storedSessionId; // Если сессия существует, используем ее
      sessionInfoEl.textContent = `Session ID: ${sessionId}`;  // Выводим sessionId под кнопкой Start
      sessionIdEl.textContent = `Session ID: ${sessionId}`;  // Выводим sessionId в логе
      log("📩 Возобновлена сессия: " + sessionId);
    } else {
      createSession(); // Если сессия не существует, создаем новую
    }
  }

  // Создание сессии при загрузке страницы
  function createSession() {
    sessionId = "sess-" + Date.now();  // Генерация уникального sessionId
    sessionStorage.setItem('sessionId', sessionId); // Сохраняем sessionId в SessionStorage
    sessionInfoEl.textContent = `Session ID: ${sessionId}`;  // Отображаем sessionId под кнопкой Start
    sessionIdEl.textContent = `Session ID: ${sessionId}`;  // Отображаем sessionId в логе
    log("📩 Сессия создана: " + sessionId);
  }

  // Добавление чанков в сессию
  function addAudioChunk(chunk) {
    const session = JSON.parse(sessionStorage.getItem(sessionId));
    if (session) {
      session.audioChunks.push(chunk);
      sessionStorage.setItem(sessionId, JSON.stringify(session));  // Обновляем сессию
    }
  }

  // Завершение сессии
  function finalizeSession() {
    sessionStorage.removeItem('sessionId');  // Удаляем sessionId из SessionStorage при завершении
    sessionInfoEl.textContent = "";  // Очищаем отображение sessionId под кнопкой Start
    sessionIdEl.textContent = "";  // Очищаем отображение sessionId в логе
    log(`Сессия ${sessionId} завершена`);
  }

  // Проверяем сессию при загрузке страницы
  window.onload = checkSession;

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
          sessionId = msg.split(":")[1];
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

      if (sessionId) {
        log(`🎧 Finished session: ${sessionId}`);
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
      await fetch(`/translator/merge?session=${sessionId}`);
      log("💾 merged");

      log("🧠 Whisper...");
      const w = await fetch(`/translator/whisper?session=${sessionId}&langPair=${encodeURIComponent(langPair)}`);
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
        const t = await fetch(`/translator/tts?session=${sessionId}&voice=${voice}&text=${encodeURIComponent(finalText)}`);
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
