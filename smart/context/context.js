/* Context module — merged Config + Context.js
   Generated: merged by assistant
*/

/* Embedded config (was smart/context/config.js) */
const CONFIG = {
  MODULE_NAME: "context",

  // Audio params
  AUDIO_SAMPLE_RATE: 44100,         // prefered sample rate for recorder worklet
  CHANNELS: 1,

  // How often send accumulated chunks (client-side can override)
  CHUNK_SEND_INTERVAL_MS: 2000,

  // Maximum size (bytes) of a single chunk send (safety)
  CHUNK_MAX_BYTES: 30 * 1024 * 1024, // 30 MB

  // Networking: module decides whether to use WS or HTTP
  USE_WEBSOCKET: true,
  WS_PATH: "/context/ws",            // WebSocket path (server module may mount it here)
  HTTP_CHUNK_PATH: "/context/chunk", // HTTP fallback endpoint

  // Merge/processing endpoints (server-side endpoints)
  MERGE_ENDPOINT: "/context/merge",
  WHISPER_ENDPOINT: "/context/whisper",
  GPT_ENDPOINT: "/context/gpt",
  TTS_ENDPOINT: "/context/tts",

  // Client behavior toggles
  AUTO_MERGE_ON_STOP: true,         // call /merge when recording stops
  AUTO_WHISPER_AFTER_MERGE: true,   // call /whisper automatically after merge

  // Debug
  DEBUG: false
};

/* ====== End of embedded config ===== */

/* --- Original context.js content (unchanged logic), but endpoints replaced to use CONFIG --- */

// UI + recorder + networking module for Context
// (the rest of the original file follows — only endpoints were rewritten to use CONFIG)

function render(mount) {
  mount.innerHTML = `
<div style="background:#f2f2f2;border-radius:12px;padding:18px;">
  <h2 style="margin:0 0 12px 0;">🎧 Context — Audio → Whisper → GPT → TTS</h2>

  <!-- Capture mode + Voice -->
  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:8px;">
      <label style="font-weight:600;">🎙️ Режим захвата:</label>
      <select id="capture-mode" style="padding:6px 10px;border-radius:6px;">
        <option value="raw">RAW — без обработки</option>
        <option value="agc">AGC — автоусиление и шумоподавление</option>
        <option value="gain">GAIN — ручное усиление</option>
      </select>
    </div>

    <div style="display:flex;align-items:center;gap:8px;">
      <label style="font-weight:600;">🧑 Голос озвучки:</label>
      <select id="voice-select" style="padding:6px 10px;border-radius:6px;">
        <option value="alloy">Alloy (универсальный)</option>
        <option value="verse">Verse (бархатный мужской)</option>
        <option value="echo">Echo (низкий тембр)</option>
        <option value="breeze">Breeze (лёгкий мужской)</option>
      </select>
    </div>
  </div>

  <!-- Processing mode + Language pair -->
  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:8px;">
      <label style="font-weight:600;">Режим обработки:</label>
      <select id="processing-mode" style="padding:6px 10px;border-radius:6px;">
        <option value="recognize">🎧 Только распознавание</option>
        <option value="translate">🔤 Перевод через GPT</option>
        <option value="assistant">🤖 Ответ ассистента</option>
      </select>
    </div>

    <div style="display:flex;align-items:center;gap:8px;">
      <label style="font-weight:600;">Языковая пара:</label>
      <select id="lang-pair" style="padding:6px 10px;border-radius:6px;">
        <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
        <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
        <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
        <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
      </select>
    </div>
  </div>

  <!-- Controls -->
  <div style="display:flex;gap:8px;justify-content:center;margin-bottom:8px;">
    <button id="start-rec" style="padding:8px 12px;border-radius:8px;">Start</button>
    <button id="stop-rec" style="padding:8px 12px;border-radius:8px;">Stop</button>
    <button id="merge-now" style="padding:8px 12px;border-radius:8px;">Merge</button>
  </div>

  <div id="log" style="height:200px;overflow:auto;background:#fff;border-radius:8px;padding:10px;border:1px solid #eee;"></div>
</div>
`;

  
// Minimal init — attach helpers but don't alter behavior
(function attachContextUIHelpers(){
  try {
    // expose getter to read UI values later
    window.getContextOptions = function() {
      return {
        captureMode: document.getElementById('capture-mode')?.value || 'raw',
        voice: document.getElementById('voice-select')?.value || 'alloy',
        processingMode: document.getElementById('processing-mode')?.value || 'recognize',
        langPair: document.getElementById('lang-pair')?.value || 'en-ru'
      };
    };

    // optional: log changes to debug console (no logic changes)
    ['capture-mode','voice-select','processing-mode','lang-pair'].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        console.log('[context UI] option changed', window.getContextOptions());
      });
    });

    // set sensible defaults (if you want different defaults, change here)
    const defaults = window.getContextOptions();
    // quick visual log
    const log = document.getElementById('log');
    if (log) log.innerHTML += `<div>UI ready — defaults: ${JSON.stringify(defaults)}</div>`;
  } catch (e) {
    console.warn('attachContextUIHelpers error', e);
  }
})();

// ===== URLs built from embedded CONFIG (merged) =====
  (function build_urls_from_config(){
    const ORIGIN = location.origin.replace(/\/$/, '');
    const WS_PATH = (CONFIG && CONFIG.WS_PATH) ? CONFIG.WS_PATH : '/context/ws';
    const HTTP_CHUNK_PATH = (CONFIG && CONFIG.HTTP_CHUNK_PATH) ? CONFIG.HTTP_CHUNK_PATH : '/context/chunk';
    const MERGE_PATH = (CONFIG && CONFIG.MERGE_ENDPOINT) ? CONFIG.MERGE_ENDPOINT : '/context/merge';
    const WHISPER_PATH = (CONFIG && CONFIG.WHISPER_ENDPOINT) ? CONFIG.WHISPER_ENDPOINT : '/context/whisper';
    const GPT_PATH = (CONFIG && CONFIG.GPT_ENDPOINT) ? CONFIG.GPT_ENDPOINT : '/context/gpt';
    const TTS_PATH = (CONFIG && CONFIG.TTS_ENDPOINT) ? CONFIG.TTS_ENDPOINT : '/context/tts';
    const USE_WS = (CONFIG && typeof CONFIG.USE_WEBSOCKET === 'boolean') ? CONFIG.USE_WEBSOCKET : true;

    // expose for debugging
    window.CONTEXT_CFG = CONFIG;
    window.CONTEXT_URLS = {
      WS_URL: USE_WS ? ORIGIN.replace(/^http/, 'ws') + WS_PATH : null,
      HTTP_CHUNK_URL: ORIGIN + HTTP_CHUNK_PATH,
      MERGE_URL: ORIGIN + MERGE_PATH,
      WHISPER_URL: ORIGIN + WHISPER_PATH,
      GPT_URL: ORIGIN + GPT_PATH,
      TTS_URL: ORIGIN + TTS_PATH
    };
  })();

  const WS_URL = window.CONTEXT_URLS.WS_URL;
  const MERGE_URL = window.CONTEXT_URLS.MERGE_URL;
  const WHISPER_URL = window.CONTEXT_URLS.WHISPER_URL;
  const GPT_URL = window.CONTEXT_URLS.GPT_URL;
  const TTS_URL = window.CONTEXT_URLS.TTS_URL;
  const CHUNK_URL = window.CONTEXT_URLS.HTTP_CHUNK_URL;

  const logEl = document.getElementById("log");
  function log(t){ 
    try{
      const p = document.createElement('div');
      p.textContent = (new Date()).toLocaleTimeString() + " — " + t;
      logEl.appendChild(p);
      logEl.scrollTop = logEl.scrollHeight;
    }catch(e){}
    if (CONFIG.DEBUG) console.log("[context] ", t);
  }

  // Recorder + worklet setup (uses CONFIG.AUDIO_SAMPLE_RATE, etc.)
  let ws, audioCtx, worklet, stream, gainNode;
// локальное состояние опций (инициализируется при старте записи)
let CURRENT_CONTEXT_OPTIONS = {};

  let buffer = [], sessionId = null, sampleRate = CONFIG.AUDIO_SAMPLE_RATE || 44100, lastSendTs = 0;
  const CHUNK_SEND_INTERVAL = CONFIG.CHUNK_SEND_INTERVAL_MS || 2000;
  const CHUNK_MAX_BYTES = CONFIG.CHUNK_MAX_BYTES || (30 * 1024 * 1024);

  // simple helpers
  function base64EncodeFloat32(float32Array) {
    const bytes = new Uint8Array(float32Array.buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i=0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  // Worklet-based recorder init
  async function initRecorder() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
      await audioCtx.audioWorklet.addModule('/context/recorder-worklet.js');
      worklet = new AudioWorkletNode(audioCtx, 'recorder-worklet');
      // connect to mic
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const src = audioCtx.createMediaStreamSource(stream);
      gainNode = audioCtx.createGain();
      src.connect(gainNode).connect(worklet);
      worklet.port.onmessage = e => {
        if (e.data && e.data.event === 'chunk') {
          handleChunk(e.data.buffer);
        }
      };
      log("Recorder initialized");
    } catch (e) {
      log("Recorder init failed: " + e.message);
    }
  }

  // WS connection (optional)
  function openWS() {
    if (!WS_URL) {
      log("WS disabled or URL not set; using HTTP fallback");
      return;
    }
    try {
      ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { log("WS connected to " + WS_URL); };
      ws.onmessage = (m) => {
        // server messages (JSON)
        try {
          const d = JSON.parse(m.data);
          log("Server: " + (d.msg || JSON.stringify(d)));
        } catch (e) {}
      };
      ws.onclose = () => { log("WS closed"); ws = null; };
      ws.onerror = (err) => { log("WS error: " + err.message); };
    } catch (e) {
      log("WS create failed: " + e.message);
    }
  }

  function closeWS() {
    try { if (ws) ws.close(); ws = null; } catch(e){}
  }

  // chunk handling: accumulate and send periodically
  function handleChunk(float32Buffer) {
    // convert to base64 to send via HTTP easily; if WS available, send binary
    try {
      const arr = new Float32Array(float32Buffer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        // send as raw Float32 array buffer
        ws.send(arr.buffer);
      } else {
        // buffer and schedule HTTP POST
        buffer.push(arr);
        const now = Date.now();
        if (now - lastSendTs > CHUNK_SEND_INTERVAL) {
          flushChunks();
          lastSendTs = now;
        }
      }
    } catch (e) {
      log("handleChunk error: " + e.message);
    }
  }

  async function flushChunks() {
    if (!buffer.length) return;
    try {
      // concatenate Float32Arrays into one blob
      let totalLen = buffer.reduce((s, x) => s + x.length, 0);
      let out = new Float32Array(totalLen);
      let offset = 0;
      buffer.forEach(arr => { out.set(arr, offset); offset += arr.length; });
      buffer = [];
      // send via fetch as application/octet-stream
      const res = await fetch(CHUNK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: out.buffer
      });
      const json = await res.json();
      if (json && json.session) {
        sessionId = json.session;
        log("Chunks uploaded, session: " + sessionId);
      } else {
        log("Chunks response: " + JSON.stringify(json));
      }
    } catch (e) {
      log("flushChunks error: " + e.message);
    }
  }

  // Controls
  document.getElementById("start-rec").onclick = async function(){
  // safe read UI options into local declared variable
  try {
    CURRENT_CONTEXT_OPTIONS = (typeof window.getContextOptions === 'function') ? window.getContextOptions() : {};
  } catch (e) {
    CURRENT_CONTEXT_OPTIONS = {};
  }
  log("Options at start: " + JSON.stringify(CURRENT_CONTEXT_OPTIONS));

  await initRecorder();
  if (CONFIG.USE_WEBSOCKET) openWS();
  log("Recording...");
  if (worklet) worklet.port.postMessage({ cmd: 'start' });
}; } catch(e){ CURRENT_CONTEXT_OPTIONS = {}; }
    log("Options at start: " + JSON.stringify(CURRENT_CONTEXT_OPTIONS));

    await initRecorder();
    if (CONFIG.USE_WEBSOCKET) openWS();
    log("Recording...");
    // tell worklet to start
    if (worklet) worklet.port.postMessage({ cmd: 'start' });
  };

  document.getElementById("stop-rec").onclick = async function(){
    if (worklet) worklet.port.postMessage({ cmd: 'stop' });
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    closeWS();
    // optionally auto-merge
    if (CONFIG.AUTO_MERGE_ON_STOP) {
      await mergeSession();
    }
    log("Stopped");
  };

  document.getElementById("merge-now").onclick = async function(){
    await mergeSession();
  };

  async function mergeSession() {
  try {
    if (!sessionId) {
      log("No session ID — nothing to merge");
      return;
    }
    log("Requesting merge for " + sessionId);
    const r = await fetch(MERGE_URL + "?session=" + encodeURIComponent(sessionId), { method: 'POST' });
    const jr = await r.json();
    log("Merge result: " + JSON.stringify(jr));

    // Если не хотим автоматически вызывать whisper — всё равно даём возможность:
    if (!CONFIG.AUTO_WHISPER_AFTER_MERGE) {
      log("AUTO_WHISPER_AFTER_MERGE disabled — merge finished");
      return;
    }

    // вызов распознавания
    const whisperRes = await callWhisper(sessionId);
    if (!whisperRes) {
      log("Whisper failed or returned empty");
      return;
    }

    const text = whisperRes.text || whisperRes.result || "";
    const detectedLang = whisperRes.detectedLang || whisperRes.language || null;

    // решаем что делать дальше по опции processingMode (значение берём из CURRENT_CONTEXT_OPTIONS)
    const mode = (CURRENT_CONTEXT_OPTIONS && CURRENT_CONTEXT_OPTIONS.processingMode) ? CURRENT_CONTEXT_OPTIONS.processingMode : 'recognize';
    const langPair = (CURRENT_CONTEXT_OPTIONS && CURRENT_CONTEXT_OPTIONS.langPair) ? CURRENT_CONTEXT_OPTIONS.langPair : null;

    if (mode === 'recognize') {
      log("Processing mode: recognize — final text: " + (text || "[empty]"));
      // нет дальнейших действий — при необходимости можно отобразить текст в UI
      return;
    }

    if (mode === 'translate') {
      log("Processing mode: translate — calling GPT translate with langPair=" + langPair);
      const gptRes = await callGPT(text, { mode: 'translate', langPair, detectedLang });
      const outText = gptRes && (gptRes.text || gptRes.finalText || "");
      log("Translate result: " + outText);
      if (outText) await callTTS(outText);
      return;
    }

    if (mode === 'assistant') {
      log("Processing mode: assistant — calling GPT assistant");
      const gptRes = await callGPT(text, { mode: 'assistant' });
      const outText = gptRes && (gptRes.text || gptRes.finalText || "");
      log("Assistant result: " + outText);
      if (outText) await callTTS(outText);
      return;
    }

    // fallback — if unknown mode, just log
    log("Unknown processing mode: " + mode);

  } catch (e) {
    log("mergeSession error: " + (e.message || String(e)));
  }
}
async function callWhisper(session) {
    try {
      log("Calling whisper for " + session);
      const r = await fetch(WHISPER_URL + "?session=" + encodeURIComponent(session));
      const jr = await r.json();
      log("Whisper: " + JSON.stringify(jr));
      // Возвращаем результат для дальнейшей обработки (mergeSession будет решать дальнейшие шаги)
      return jr;
    } catch (e) {
      log("callWhisper error: " + (e.message || String(e)));
      return null;
    }
  }
// callGPT принимает text и опциональный объект opts { mode, langPair, detectedLang, ... }
// Возвращает разобранный JSON-ответ от сервера
async function callGPT(text, opts = {}) {
  try {
    log("Calling GPT with opts: " + JSON.stringify(opts));
    const r = await fetch(GPT_URL, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({ text }, opts))
    });
    const jr = await r.json();
    log("GPT: " + JSON.stringify(jr));
    return jr;
  } catch (e) {
    log("callGPT error: " + (e.message || String(e)));
    return null;
  }
}
async function callTTS(finalText) {
    try {
      log("🔊 TTS...");
      const t = await fetch(`${TTS_URL}?session=${encodeURIComponent(sessionId)}&voice=${encodeURIComponent(document.getElementById('voice-select').value)}&text=${encodeURIComponent(finalText)}`);
      const tData = await t.json();
      log(`🔊 ${tData.url}`);
    } catch (e) {
      log("callTTS error: " + e.message);
    }
  }
}

// if module system expects named export — export render/unload
// try to not break existing loader: attach to window and export if module system present
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { render };
}
if (typeof window !== 'undefined') {
  window.contextRender = render;
}
