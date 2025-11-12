// === Voice Recorder (start-gated, with rich logging) ===
// Страница НИЧЕГО не делает, пока пользователь не нажал Start.

import SVAudioCore from "./audiocore/sv-audio-core.js";
import WavSegmenter from "./audiocore/wav-segmenter.js";
// Assembler is optional now; server assembles -> MP3
// import WavAssembler from "./audiocore/wav-assembler.js";

// ---------- DOM ----------
const statusEl = document.getElementById("status");
const startBtn  = document.getElementById("startBtn");
const pauseBtn  = document.getElementById("pauseBtn");
const stopBtn   = document.getElementById("stopBtn");
const playerEl  = document.getElementById("sv-player");
const listEl    = document.getElementById("record-list");

const setStatus = (s) => {
  if (statusEl) statusEl.textContent = s;
  console.log("🧭 [STATE]", s);
};

// ---------- Globals for current session ----------
let core = null;          // SVAudioCore instance
let segmenter = null;     // WavSegmenter instance
let ws = null;            // WebSocket
let recordingId = null;
let paused = false;

// ---------- WS ----------
async function connectWS(recId) {
  const state = (window.SVID && typeof SVID.getState === "function")
    ? SVID.getState()
    : {};
  const userId = state.user_id || state.visitor_id || "anon";

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws/voicerecorder`;
  console.log("🌐 [WS] Connecting to:", url);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("✅ [WS] Connected, sending START");
    ws.send(
      "START " +
      JSON.stringify({ user_id: userId, rec_id: recId, ext: ".wav" })
    );
  };

  ws.onmessage = (ev) => {
    console.log("📨 [WS] Message:", ev.data);
    try {
      const d = JSON.parse(ev.data);
      if (d.status === "SAVED") {
        console.log("💾 [WS] Saved file URL:", d.url);
        if (listEl) {
          const li = document.createElement("li");
          li.innerHTML = `<a href="${d.url}" target="_blank">${d.url}</a>`;
          listEl.prepend(li);
        }
        // auto-load preview
        if (playerEl) {
          playerEl.src = d.url;
          playerEl.classList.remove("sv-player--disabled");
        }
        setStatus("saved");
      }
    } catch {
      // non-JSON informational messages
    }
  };

  ws.onerror = (e) => console.error("❌ [WS] Error:", e);
  ws.onclose = (ev) => {
    console.log("🛑 [WS] Closed:", ev.code, ev.reason);
  };
}

// Отдельная функция, если захотим где-то ещё инициировать END
async function stopWS() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("🧹 [WS] Sending END");
    ws.send("END");
  }
  // ws сам закроется после ответа сервера; обнулять не обязательно
}

// ---------- Lifecycle ----------
async function start() {
  if (core) {
    console.warn("start(): already running");
    return;
  }

  // ID для данной сессии записи
  recordingId = (crypto?.randomUUID?.() || `rec_${Date.now()}`);
  console.log("🎬 [START] recId =", recordingId);
  setStatus("starting…");

  // 1) Init audio core (создаёт AudioContext, грузит worklet)
  core = new SVAudioCore({
    chunkSize: 2048,
    workletUrl: "voicerecorder/audiocore/recorder.worklet.js",
  });
  await core.init(); // происходит только после клика по Start
  console.log("🎛️ [CORE] AudioContext SR =", core.getContext()?.sampleRate);

  // 2) Init segmenter для строгих 2-секундных сегментов
  segmenter = new WavSegmenter({
    sampleRate: core.getContext()?.sampleRate || 48000,
    segmentSeconds: 2,
    normalize: true,
    emitBlobPerSegment: true
    // padLastSegment НЕ указываем → новый дефолт = true,
    // поэтому последний сегмент тоже будет ровно 2 сек (добьётся нулями)
  });

  segmenter.onSegment = (seg) => {
    // Отправляем только если сокет реально открыт
    if (!seg?.blob) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(
        "📦 [SEG] drop / WS not ready",
        "seq",
        seg.seq,
        "dur",
        seg.durationSec.toFixed(2),
        "blob",
        seg.blob.size
      );
      return;
    }

    console.log(
      "📦 [SEG] send chunk seq",
      seg.seq,
      "dur",
      seg.durationSec.toFixed(2),
      "blob",
      seg.blob.size
    );

    try {
      // ВАЖНО: отправляем Blob напрямую, без async arrayBuffer(),
      // чтобы не было гонки с ws = null / END.
      ws.send(seg.blob);
    } catch (e) {
      console.error("❌ [SEG] send failed", e);
    }
  };

  // 3) Wire frames -> segmenter
  core.onAudioFrame = (f32) => {
    // Каждый входящий фрейм просто скармливаем сегментеру
    segmenter.pushFrame(f32);
  };

  // 4) Открываем WebSocket
  await connectWS(recordingId);

  // 5) UI state
  paused = false;
  startBtn?.setAttribute("disabled", "true");
  pauseBtn?.removeAttribute("disabled");
  stopBtn?.removeAttribute("disabled");
  setStatus("recording");
}

async function pause() {
  if (!core) return;
  if (!paused) {
    core.pauseCapture();
    paused = true;
    setStatus("paused");
    console.log("⏸ [PAUSE]");
    if (pauseBtn) pauseBtn.textContent = "Resume";
  } else {
    core.resumeCapture();
    paused = false;
    setStatus("recording");
    console.log("▶️ [RESUME]");
    if (pauseBtn) pauseBtn.textContent = "Pause";
  }
}

async function stop() {
  if (!core) return;
  setStatus("stopping…");

  try {
    // Сначала просим сегментер ДОБРАТЬ последний сегмент (он будет ровно 2 сек)
    segmenter?.stop();
  } catch (e) {
    console.warn(e);
  }

  // Теперь, когда все сегменты уже отданы через onSegment, сообщаем серверу END
  await stopWS();

  try {
    core.stop();
  } catch (e) {
    console.warn(e);
  }

  core = null;
  segmenter = null;
  recordingId = null;
  paused = false;

  // UI → idle
  startBtn?.removeAttribute("disabled");
  pauseBtn?.setAttribute("disabled", "true");
  stopBtn?.setAttribute("disabled", "true");
  if (pauseBtn) pauseBtn.textContent = "Pause";

  setStatus("idle");
  console.log("🏁 [STOP] done");
}

// ---------- Bind buttons ----------
document.addEventListener("DOMContentLoaded", () => {
  // ВАЖНО: здесь только биндим кнопки, ничего не запускаем сами
  startBtn?.addEventListener("click", start);
  pauseBtn?.addEventListener("click", pause);
  stopBtn?.addEventListener("click", stop);
  console.log("🧷 [BIND] Buttons wired. Waiting for Start…");
});
