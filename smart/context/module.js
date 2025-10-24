// ======== Context Module (v1.3 — add process mode + lang pair) ========
// Встраивание без iframe. Recorder Worklet грузим из /smart/context/

export async function render(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2; border-radius:12px; padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎧 Context v1 — Audio → Server → Whisper</h2>

      <div style="text-align:center; margin-bottom:10px;">
        <label for="capture-mode" style="font-weight:600;">Режим захвата:</label>
        <select id="capture-mode" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="raw">🎧 RAW — без обработки (чистый микрофон)</option>
          <option value="agc">🧠 AGC — автоусиление и шумоподавление</option>
          <option value="gain">📢 GAIN — ручное усиление (громче, без фильтров)</option>
        </select>
      </div>

      <div style="text-align:center; margin-bottom:10px;">
        <label for="process-mode" style="font-weight:600;">Режим обработки:</label>
        <select id="process-mode" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="recognize">🎧 Только распознавание</option>
          <option value="translate">🔤 Перевод через GPT</option>
          <option value="assistant">🤖 Ответ ассистента</option>
        </select>
      </div>

      <div style="text-align:center; margin-bottom:10px;">
        <label for="lang-pair" style="font-weight:600;">Языковая пара:</label>
        <select id="lang-pair" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
          <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
          <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
          <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
        </select>
      </div>

      <div class="controls" style="text-align:center; margin-bottom:10px;">
        <button id="ctx-start" style="padding:10px 20px;border:none;border-radius:8px;background:#4caf50;color:#fff;">Start</button>
        <button id="ctx-stop"  style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>

      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#ctx-start");
  const btnStop  = mount.querySelector("#ctx-stop");
  const modeSel  = mount.querySelector("#capture-mode");
  const procSel  = mount.querySelector("#process-mode");
  const langSel  = mount.querySelector("#lang-pair");

  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
  let ws, audioCtx, worklet, stream;
  let buffer = [];
  let total = 0;
  let lastSend = 0;
  let sampleRate = 44100;
  let sessionId = null;

  function log(msg) {
    const linked = msg.replace(/(https?:\/\/[^\s]+)/g, (url) => `<a href="${url}" target="_blank">${url}</a>`);
    const line = document.createElement("div");
    line.innerHTML = linked;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
  }

  function logError(err) {
    console.error(err);
    log('❌ Ошибка: ' + (err?.message || String(err)));
  }

  btnStart.onclick = async () => {
    try {
      const mode = modeSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;
      log(`🎚️ Захват: ${mode.toUpperCase()} | 🧠 Обработка: ${processMode} | 🌐 Пара: ${langPair}`);

      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) {
          sessionId = msg.split(":")[1];
          log('📩 SESSION:' + sessionId);
        } else {
          log('📩 ' + msg);
        }
      };

      ws.onclose = () => log('❌ Disconnected');

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      log('🎛 Detected SampleRate: ' + sampleRate + ' Hz');

      await audioCtx.audioWorklet.addModule('context/recorder-worklet.js');

      ws.onopen = () => {
        log('✅ Connected to WebSocket server');
        ws.send(JSON.stringify({ type: 'meta', sampleRate, mode, processMode, langPair }));
      };

      // параметры захвата
      let constraints;
      if (mode === 'agc') {
        constraints = { audio: { autoGainControl: true, noiseSuppression: true, echoCancellation: true } };
      } else {
        constraints = { audio: { autoGainControl: false, noiseSuppression: false, echoCancellation: false } };
      }

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, 'recorder-processor');
      worklet.port.postMessage({ mode, processMode, langPair });
      source.connect(worklet);

      const INTERVAL = 2000;
      lastSend = performance.now();

      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        buffer.push(chunk);
        total += chunk.length;
        const now = performance.now();
        if (now - lastSend >= INTERVAL) {
          sendBlock();
          lastSend = now;
        }
      };

      log('🎙️ Recording started');
      btnStart.disabled = true;
      btnStop.disabled = false;
    } catch (err) {
      logError(err);
      try { if (audioCtx) await audioCtx.close(); } catch {}
      try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch {}
      try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
      btnStart.disabled = false;
      btnStop.disabled = true;
    }
  };

  function concat(chunks) {
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    const res = new Float32Array(totalLen);
    let offset = 0;
    for (const part of chunks) {
      res.set(part, offset);
      offset += part.length;
    }
    return res;
  }

  function sendBlock(pad = false) {
    if (!buffer.length) return;
    let full = concat(buffer);
    if (pad) {
      const target = Math.round(sampleRate * 2);
      if (full.length < target) {
        const padded = new Float32Array(target);
        padded.set(full);
        full = padded;
        log('🫧 Padded last block');
      }
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(full.buffer);
      log('🎧 Sent ' + full.byteLength + ' bytes @ ' + sampleRate + ' Hz');
    }
    buffer = [];
    total = 0;
  }

  btnStop.onclick = () => {
    try {
      sendBlock(true);
      if (audioCtx) audioCtx.close();
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      log('⏹️ Stopped');
      btnStart.disabled = false;
      btnStop.disabled = true;
    } catch (e) {
      logError(e);
    }
  };
}
