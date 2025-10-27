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
      <p id="sample-rate-display" style="text-align:center; font-weight: bold;">Частота дискретизации:</p> <!-- Здесь будет частота -->
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
        <button id="play-recording" disabled>Play Recording</button>
      </div>
      <div id="ctx-log" style="min-height:300px;overflow:auto;">
        <!-- Лог сессии будет отображаться здесь -->
      </div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const btnPlay = mount.querySelector("#play-recording");
  const voiceSel = mount.querySelector("#voice-select");
  const langSel = mount.querySelector("#lang-pair");

  let ws, audioCtx, stream;
  let audioBuffer = [];  // Массив для хранения аудио чанков
  const WS_URL = location.protocol === "https:" ? "wss://" + location.host : "ws://" + location.host;
  let sendTimer;

  function log(msg) {
    const div = document.createElement("div");
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function sendSessionIdToServer(sessionId, langPair, voice, sampleRate) {
    log("✅ Session ID and meta-data sent to server: " + sessionId);
    const metaData = {
      type: "register",
      session: sessionId,
      langPair: langPair,
      voice: voice,
      sampleRate: sampleRate
    };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(metaData));  // Отправляем мета-данные
    }
  }

  log("Сессия ID: " + customSessionId);

  btnStart.onclick = async () => {
    try {
      const voice = voiceSel.value;
      const langPair = langSel.value;

      // Инициализация audioCtx до WebSocket
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Замер частоты дискретизации
      const sampleRate = audioCtx.sampleRate;  // Получаем частоту дискретизации
      log("Частота дискретизации:", sampleRate);

      // Отображаем частоту дискретизации на странице
      const sampleRateElement = mount.querySelector("#sample-rate-display");
      sampleRateElement.textContent = `Частота дискретизации: ${sampleRate} Hz`;

      // Проверяем, открыт ли WebSocket
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws = new WebSocket(WS_URL);
        ws.binaryType = "arraybuffer";
      }

      ws.onmessage = (e) => {
        const msg = String(e.data);
        log("📩 Сообщение от сервера: " + msg);
        try {
          const parsedMsg = JSON.parse(msg);
          if (parsedMsg && parsedMsg.type === "SESSION") {
            customSessionId = parsedMsg.sessionId;
            document.getElementById("session-id-display").textContent = `Сессия ID: ${customSessionId}`;
            log(`✅ Session ID received from server: ${customSessionId}`);
          }
        } catch (error) {
          log("⚠️ Ошибка при обработке сообщения: " + error.message);
        }
      };

      ws.onopen = () => {
        log("✅ WebSocket connection opened");
        sendSessionIdToServer(customSessionId, langSel.value, voiceSel.value, sampleRate);
        ws.send(JSON.stringify({ type: "ping-init" }));
      };

      ws.onclose = () => log("❌ WebSocket connection closed");
      ws.onerror = (error) => {
        log(`⚠️ WebSocket ошибка: ${error.message}`);
        console.error(error);
      };

      // Получаем поток аудио с микрофона с дополнительными улучшениями
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,  // Подавление эха
          noiseSuppression: true,  // Подавление шума
          autoGainControl: true    // Контроль усиления
        }
      });

      // Создаем аудиоконтекст для обработки данных
      const source = audioCtx.createMediaStreamSource(stream);

      // Регистрация AudioWorklet для обработки аудио в реальном времени
      await audioCtx.audioWorklet.addModule('./smart/translator/recorder-worklet.js')
        .then(() => {
          const workletNode = new AudioWorkletNode(audioCtx, 'recorder-processor');
          source.connect(workletNode);
          workletNode.connect(audioCtx.destination);

          // При получении данных от worklet добавляем их в буфер
          workletNode.port.onmessage = (e) => {
            const chunk = e.data;  // Получаем аудиофрейм
            audioBuffer.push(chunk);  // Добавляем в буфер
          };
        })
        .catch((error) => {
          log("❌ Ошибка при регистрации AudioWorkletNode: " + error.message);
        });

      // Отправляем аудио данные каждую секунду
      sendTimer = setInterval(() => {
        if (audioBuffer.length > 0 && ws.readyState === WebSocket.OPEN) {
          const chunk = audioBuffer.splice(0, audioBuffer.length);  // Берем все данные из буфера
          ws.send(chunk.buffer);  // Отправляем весь чанк
        }
      }, 1000);  // Интервал отправки данных — 1 секунда

      btnStart.disabled = true;
      btnStop.disabled = false;
      log("🎙️ Recording started");

    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

  btnStop.onclick = async () => {
    try {
      clearInterval(sendTimer); // Очистка интервала
      if (stream) {
        stream.getTracks().forEach(track => track.stop());  // Останавливаем все треки потока
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      log("⏹️ Recording stopped");
      btnStart.disabled = false;
      btnStop.disabled = true;
      if (customSessionId) log(`🎧 Finished session: ${customSessionId}`);
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };
}
