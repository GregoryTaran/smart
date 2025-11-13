// === Voice Recorder (start-gated, with rich logging) ===
// Страница НИЧЕГО не делает, пока пользователь не нажал Start.

import SVAudioCore from "./audiocore/sv-audio-core.js";
import WavSegmenter from "./audiocore/wav-segmenter.js";
import MicIndicator from "./mic-indicator/mic-indicator.js";

// ---------- DOM ----------
const statusEl = document.getElementById("status");
const startBtn  = document.getElementById("startBtn");
const pauseBtn  = document.getElementById("pauseBtn");
const stopBtn   = document.getElementById("stopBtn");
const playerEl  = document.getElementById("sv-player");
const listEl    = document.getElementById("record-list");

// ВАЖНО: ИСПОЛЬЗУЕМ ПРАВИЛЬНЫЙ DOM-ЭЛЕМЕНТ
const micIndicatorEl = document.getElementById("vc-level");

const setStatus = (s) => {
  if (statusEl) statusEl.textContent = s;
  console.log("🧭 [STATE]", s);
};

// ---------- Globals ----------
let core = null;
let segmenter = null;
let ws = null;
let recordingId = null;
let paused = false;

let indicator = null;

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
    ws.send("START " + JSON.stringify({ user_id: userId, rec_id: recId, ext: ".wav" }));
  };

  ws.onmessage = (ev) => {
    console.log("📨 [WS] Message:", ev.data);
    try {
      const d = JSON.parse(ev.data);
      if (d.status === "SAVED") {
        console.log("💾 [WS] Saved file URL:", d.url);

        const li = document.createElement("li");
        li.innerHTML = `<a href="${d.url}" target="_blank">${d.url}</a>`;
        listEl.prepend(li);

        playerEl.src = d.url;
        playerEl.classList.remove("sv-player--disabled");

        setStatus("saved");
      }
    } catch {}
  };

  ws.onerror = (e) => console.error("❌ [WS] Error:", e);
  ws.onclose = (ev) => console.log("🛑 [WS] Closed:", ev.code, ev.reason);
}

async function stopWS() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("🧹 [WS] Sending END");
    ws.send("END");
  }
}

// ---------- Lifecycle ----------
async function start() {
  if (core) return;

  recordingId = crypto.randomUUID();
  console.log("🎬 [START] recId =", recordingId);
  setStatus("starting…");

  // === Audio core ===
  core = new SVAudioCore({
    chunkSize: 2048,
    workletUrl: "voicerecorder/audiocore/recorder.worklet.js",
  });
  await core.init();
  console.log("🎛️ [CORE] AudioContext SR =", core.getContext()?.sampleRate);

  // === Mic indicator ===
  if (!indicator && micIndicatorEl) {
    indicator = new MicIndicator(micIndicatorEl);
  }
  if (indicator && core.stream) {
    await indicator.connectStream(core.stream);
  }

  // === Segmenter ===
  segmenter = new WavSegmenter({
    sampleRate: core.getContext()?.sampleRate || 48000,
    segmentSeconds: 2,
    normalize: true,
    emitBlobPerSegment: true
  });

  segmenter.onSegment = (seg) => {
    if (!seg?.blob) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("📦 [SEG] drop WS not ready", seg.seq);
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
    ws.send(seg.blob);
  };

  // === Frames → indicator + segmenter ===
  core.onAudioFrame = (f32) => {
    if (indicator) {
      const rms = Math.sqrt(f32.reduce((s, v) => s + v * v, 0) / f32.length);
      indicator.setSimLevel(rms);
    }
    if (segmenter) segmenter.pushFrame(f32);
  };

  await connectWS(recordingId);

  paused = false;
  startBtn.setAttribute("disabled", "true");
  pauseBtn.removeAttribute("disabled");
  stopBtn.removeAttribute("disabled");
  setStatus("recording");
}

async function pause() {
  if (!core) return;
  if (!paused) {
    core.pauseCapture();
    paused = true;
    pauseBtn.textContent = "Resume";
    setStatus("paused");
  } else {
    core.resumeCapture();
    paused = false;
    pauseBtn.textContent = "Pause";
    setStatus("recording");
  }
}

async function stop() {
  if (!core) return;

  setStatus("stopping…");
  indicator?.setInactive();

  segmenter?.stop();
  await stopWS();

  core.stop();
  core = null;
  segmenter = null;
  ws = null;
  recordingId = null;
  paused = false;

  startBtn.removeAttribute("disabled");
  pauseBtn.setAttribute("disabled", "true");
  stopBtn.setAttribute("disabled", "true");
  pauseBtn.textContent = "Pause";

  setStatus("idle");
  console.log("🏁 [STOP] done");
}

// Bind UI
document.addEventListener("DOMContentLoaded", () => {
  startBtn.addEventListener("click", start);
  pauseBtn.addEventListener("click", pause);
  stopBtn.addEventListener("click", stop);
  console.log("🧷 [BIND] ready");
});
