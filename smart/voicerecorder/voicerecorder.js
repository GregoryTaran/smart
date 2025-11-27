// === Voice Recorder (STRICT SVID VERSION — NO TEMP IDs) ===
// Запись невозможна без user_id или visitor_id.
// Если идентификатор не готов — кнопка Start заблокирована,
// запись не стартует, WS не открывается.

import SVAudioCore from "./audiocore/sv-audio-core.js";
import WavSegmenter from "./audiocore/wav-segmenter.js";
import MicIndicator from "./mic-indicator/mic-indicator.js";

const statusEl = document.getElementById("status");
const startBtn  = document.getElementById("startBtn");
const pauseBtn  = document.getElementById("pauseBtn");
const stopBtn   = document.getElementById("stopBtn");
const playerEl  = document.getElementById("sv-player");
const listEl    = document.getElementById("record-list");
const micIndicatorEl = document.getElementById("vc-level");

let core = null;
let segmenter = null;
let ws = null;
let recordingId = null;
let paused = false;
let indicator = null;

const setStatus = (s) => {
  if (statusEl) statusEl.textContent = s;
};

// ================================================================
// 🔥 ЖЕСТКАЯ ВЕРСИЯ: user_id/visitor_id ОБЯЗАТЕЛЕН
// ================================================================
async function ensureUserId() {
  // Ждём APP_READY, если есть
  if (window.APP_READY) {
    try { await window.APP_READY; } catch {}
  }

  // Ждём SVID.ready
  if (window.SVID?.ready) {
    try { await window.SVID.ready; } catch {}
  }

  const s = window.SVID?.getState?.() || {};

  // ✔︎ допускаем user_id
  if (s.user_id) return s.user_id;

  // ✔︎ допускаем visitor_id (аноним, но постоянный)
  if (s.visitor_id) return s.visitor_id;

  // ❌ ID нет — приложение ещё не готово
  throw new Error("SVID_ID_MISSING");
}

// ================================================================
// 🔥 WebSocket (но открываем только когда есть ID)
// ================================================================
async function connectWS(recId) {
  const userId = await ensureUserId();  // гарантированно есть

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws/voicerecorder`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send("START " + JSON.stringify({ user_id: userId, rec_id: recId, ext: ".wav" }));
  };

  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.status === "SAVED") {
        const li = document.createElement("li");
        li.innerHTML = `<a href="${d.url}" target="_blank">${d.url}</a>`;
        listEl.prepend(li);

        playerEl.src = d.url;
        playerEl.classList.remove("sv-player--disabled");
        setStatus("saved");
      }
    } catch {}
  };
}

async function stopWS() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send("END");
  }
}

// ================================================================
// 🔥 START — запись запрещена без ID
// ================================================================
async function start() {
  if (core) return;

  // 1) Проверяем ID до начала записи
  try {
    await ensureUserId();
  } catch {
    setStatus("Нет user_id / visitor_id — запись невозможна");
    console.error("Диктофон: нет ID — блокировка старта");
    return;
  }

  setStatus("starting…");
  recordingId = crypto.randomUUID();

  if (indicator) indicator.unfreeze();

  core = new SVAudioCore({
    chunkSize: 2048,
    workletUrl: "voicerecorder/audiocore/recorder.worklet.js",
  });
  await core.init();

  const stream = core.getStream();
  if (indicator && stream) {
    await indicator.connectStream(stream);
  }

  segmenter = new WavSegmenter({
    sampleRate: core.getContext()?.sampleRate || 48000,
    segmentSeconds: 2,
    normalize: true,
    emitBlobPerSegment: true
  });

  segmenter.onSegment = (seg) => {
    if (!seg?.blob) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(seg.blob);
  };

  core.onAudioFrame = (f32) => {
    if (segmenter) segmenter.pushFrame(f32);
  };

  // 2) WS Открываем только когда ID точно есть
  await connectWS(recordingId);

  paused = false;
  startBtn.setAttribute("disabled", "true");
  pauseBtn.removeAttribute("disabled");
  stopBtn.removeAttribute("disabled");

  setStatus("recording");
}

// ================================================================
// 🔥 PAUSE
// ================================================================
async function pause() {
  if (!core) return;

  if (!paused) {
    core.pauseCapture();
    paused = true;
    pauseBtn.textContent = "Resume";
    setStatus("paused");
    indicator?.freeze();
  } else {
    core.resumeCapture();
    paused = false;
    pauseBtn.textContent = "Pause";
    setStatus("recording");
    indicator?.unfreeze();
  }
}

// ================================================================
// 🔥 STOP
// ================================================================
async function stop() {
  if (!core) return;

  setStatus("stopping…");

  indicator?.baselineOnly();

  segmenter?.stop();

  await new Promise(res => setTimeout(res, 250));
  await stopWS();

  await new Promise(res => {
    const f = setInterval(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        clearInterval(f);
        res();
      }
    }, 50);
  });

  core.stop();

  core = null;
  segmenter = null;
  recordingId = null;
  ws = null;

  startBtn.removeAttribute("disabled");
  pauseBtn.setAttribute("disabled", "true");
  stopBtn.setAttribute("disabled", "true");
  pauseBtn.textContent = "Pause";

  setStatus("idle");
}

// ================================================================
// 🔥 INIT — ждём ID, если нет — кнопка Start заблокирована
// ================================================================
document.addEventListener("DOMContentLoaded", async () => {
  indicator = new MicIndicator(micIndicatorEl);
  indicator.baselineOnly();

  // Изначально блокируем Start
  startBtn.setAttribute("disabled", "true");

  // Проверяем ID (может быть уже есть)
  try {
    await ensureUserId();
    startBtn.removeAttribute("disabled");
    setStatus("ready");
  } catch {
    setStatus("Инициализация идентификатора…");

    // Пробуем раз в 300мс
    const interval = setInterval(async () => {
      try {
        await ensureUserId();
        startBtn.removeAttribute("disabled");
        setStatus("ready");
        clearInterval(interval);
      } catch {}
    }, 300);
  }

  startBtn.addEventListener("click", start);
  pauseBtn.addEventListener("click", pause);
  stopBtn.addEventListener("click", stop);
});
