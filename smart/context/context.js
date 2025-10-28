// ================================
// Context module: dynamic config loader (MINOR PATCH)
// Place this at the VERY TOP of smart/context/context.js
// ================================

(async function loadContextConfigAndStart(){
  // try to import the client config; fallback to safe defaults
  let cfg = {};
  try {
    // cache-buster using app version if available
    const v = (window.APP && window.APP.VERSION) ? window.APP.VERSION : Date.now();
    cfg = (await import(`/context/config.js?v=${v}`)).default || {};
  } catch (err) {
    console.warn('Context: failed to load /context/config.js, using defaults', err);
    cfg = {};
  }

  // Expose for debugging if needed
  window.CONTEXT_CONFIG = cfg;

  // Build useful URLs with safe fallbacks
  const ORIGIN = location.origin;
  const WS_PATH = cfg.WS_PATH || '/context/ws';
  const HTTP_CHUNK_PATH = cfg.HTTP_CHUNK_PATH || '/context/chunk';
  const MERGE_PATH = cfg.MERGE_ENDPOINT || '/context/merge';
  const WHISPER_PATH = cfg.WHISPER_ENDPOINT || '/context/whisper';
  const GPT_PATH = cfg.GPT_ENDPOINT || '/context/gpt';
  const TTS_PATH = cfg.TTS_ENDPOINT || '/context/tts';
  const USE_WS = (typeof cfg.USE_WEBSOCKET === 'boolean') ? cfg.USE_WEBSOCKET : true;

  const urls = {
    WS_URL: USE_WS ? ORIGIN.replace(/^http/, 'ws') + WS_PATH : null,
    HTTP_CHUNK_URL: ORIGIN + HTTP_CHUNK_PATH,
    MERGE_URL: ORIGIN + MERGE_PATH,
    WHISPER_URL: ORIGIN + WHISPER_PATH,
    GPT_URL: ORIGIN + GPT_PATH,
    TTS_URL: ORIGIN + TTS_PATH
  };

  // If the existing code exposes a bootstrap function, call it with cfg+urls.
  // We'll add the wrapper in the next tiny step (you'll either create window.contextMain or I'll provide exact replacement).
  if (typeof window.contextMain === 'function') {
    try { window.contextMain({ cfg, urls }); }
    catch (e) { console.error('contextMain failed:', e); }
  } else {
    // If not present — just attach cfg/urls to window and let the rest of the file pick them up.
    window.CONTEXT_CFG = cfg;
    window.CONTEXT_URLS = urls;
    console.warn('contextMain() not found — existing init must read window.CONTEXT_CFG / window.CONTEXT_URLS or you must add window.contextMain wrapper.');
  }

})();


// context.js
// Client-side module for Context page (mount — DOM element).
// Adapted from your original module; uses /context/* endpoints and /context/ws WebSocket.

export async function render(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎧 Context — Audio → Whisper → GPT → TTS</h2>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">🎙️ Режим захвата:</label>
        <select id="capture-mode" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="raw">RAW — без обработки</option>
          <option value="agc">AGC — автоусиление и шумоподавление</option>
          <option value="gain">GAIN — ручное усиление</option>
        </select>
      </div>

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
        <button id="ctx-start" style="padding:10px 20px;border:none;border-radius:8px;background:#4caf50;color:#fff;">Start</button>
        <button id="ctx-stop"  style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>

      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#ctx-start");
  const btnStop  = mount.querySelector("#ctx-stop");
  const captureSel = mount.querySelector("#capture-mode");
  const procSel  = mount.querySelector("#process-mode");
  const langSel  = mount.querySelector("#lang-pair");
  const voiceSel = mount.querySelector("#voice-select");

  // namespaced WS + HTTP endpoints
  const WS_URL = `${location.origin.replace(/^http/, "ws")}/context/ws`;
  const MERGE_URL = `/context/merge`;
  const WHISPER_URL = `/context/whisper`;
  const GPT_URL = `/context/gpt`;
  const TTS_URL = `/context/tts`;
  const CHUNK_URL = `/context/chunk`;

  let ws, audioCtx, worklet, stream, gainNode;
  let buffer = [], sessionId = null, sampleRate = 44100, lastSend = 0, fallbackSession = null;

  function log(msg) {
    const div = document.createElement("div");
    div.innerHTML = msg.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  btnStart.onclick = async () => {
    try {
      const mode = captureSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;
      const voice = voiceSel.value;

      // reset
      buffer = [];
      sessionId = null;
      fallbackSession = `sess-${Date.now()}`;

      // try WebSocket first
      try {
        ws = new WebSocket(WS_URL);
        ws.binaryType = "arraybuffer";
        ws.onmessage = (e) => {
          const msg = String(e.data);
          if (msg.startsWith("SESSION:")) sessionId = msg.split(":")[1];
          log("📩 " + msg);
        };
        ws.onclose = () => log("❌ WS Disconnected");
      } catch (e) {
        console.warn("WS open error", e);
        ws = null;
      }

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      log("🎛 SampleRate: " + sampleRate + " Hz");

      await audioCtx.audioWorklet.addModule("context/recorder-worklet.js");

      if (ws) {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "meta", sampleRate, mode, processMode, langPair, voice }));
          log("✅ Connected to WebSocket");
        };
      } else {
        log("⚠️ WebSocket failed — using HTTP fallback for chunks");
      }

      const constraints = {
        audio: {
          echoCancellation: mode === "agc",
          noiseSuppression: mode === "agc",
          autoGainControl: mode === "agc"
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, "recorder-processor");

      if (mode === "gain") {
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 2.0;
        source.connect(gainNode).connect(worklet);
      } else {
        source.connect(worklet);
      }

      worklet.port.onmessage = (e) => {
        const chunk = e.data; // Float32Array
        buffer.push(chunk);
        const now = performance.now();
        if (now - lastSend >= 2000) {
          sendBlock();
          lastSend = now;
        }
      };

      log("🎙️ Recording started");
      btnStart.disabled = true;
      btnStop.disabled = false;
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

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

  async function sendBlock() {
    if (!buffer.length) return;
    const full = concat(buffer);
    buffer = [];

    // Try WS first
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(full.buffer);
        log(`🎧 Sent ${full.length} samples via WS`);
        return;
      } catch (e) {
        console.warn("ws send failed", e);
      }
    }

    // Fallback: send via HTTP POST to /context/chunk
    try {
      const sess = sessionId || fallbackSession;
      const resp = await fetch(`${CHUNK_URL}?session=${encodeURIComponent(sess)}&sampleRate=${sampleRate}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: full.buffer,
      });
      if (resp.ok) {
        log(`🎧 Sent ${full.length} samples via HTTP fallback (session ${sess})`);
      } else {
        log("❌ HTTP chunk upload failed: " + resp.status);
      }
    } catch (e) {
      console.error("chunk POST error", e);
      log("❌ chunk POST error: " + e.message);
    }
  }

  btnStop.onclick = async () => {
    try {
      await sendBlock();
      if (audioCtx) await audioCtx.close();
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();

      log("⏹️ Recording stopped");
      btnStart.disabled = false;
      btnStop.disabled = true;

      // choose session id
      const sess = sessionId || fallbackSession;
      if (!sess) return log("❔ Нет sessionId");

      await processSession(sess);
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

  async function processSession(sess) {
    try {
      const voice = voiceSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;

      log("🧩 Объединяем чанки...");
      await fetch(`${MERGE_URL}?session=${encodeURIComponent(sess)}`);
      const mergedUrl = location.origin + "/" + sess + "_merged.wav";
      log("💾 " + mergedUrl);

      log("🧠 Whisper...");
      const w = await fetch(`${WHISPER_URL}?session=${encodeURIComponent(sess)}&langPair=${encodeURIComponent(langPair)}`);
      const data = await w.json();
      const text = data.text || "";
      const detectedLang = data.detectedLang || null;
      log("🧠 → " + text);
      log("🌐 Detected language: " + (detectedLang || "none"));

      let finalText = text;
      if (processMode !== "recognize") {
        log("🤖 GPT...");
        const body = { text, mode: processMode, langPair, detectedLang };
        const g = await fetch(GPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const gData = await g.json();
        finalText = gData.text;
        log("🤖 → " + finalText);
      }

      if (finalText) {
        log("🔊 TTS...");
        const t = await fetch(`${TTS_URL}?session=${encodeURIComponent(sess)}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(finalText)}`);
        const tData = await t.json();
        log(`🔊 ${tData.url}`);
      }
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  }
}
