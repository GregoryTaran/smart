// === Voice Recorder (final integrated version) ===
// Готовая версия, полностью совместимая с MicIndicator

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

// ---------- WS ----------
async function connectWS(recId) {
  const state = (window.SVID && typeof SVID.getState === "function")
    ? SVID.getState()
    : {};

  const userId = state.user_id || state.visitor_id || "anon";
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

// ---------- START ----------
async function start() {
  if (core) return;

  setStatus("starting…");
  recordingId = crypto.randomUUID();

  // индикатор активируем заранее
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

  // === Segmenter ===
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

  await connectWS(recordingId);

  paused = false;
  startBtn.setAttribute("disabled", "true");
  pauseBtn.removeAttribute("disabled");
  stopBtn.removeAttribute("disabled");

  setStatus("recording");
}

// ---------- PAUSE ----------
async function pause() {
  if (!core) return;

  if (!paused) {
    // ставим запись на паузу
    core.pauseCapture();
    paused = true;
    pauseBtn.textContent = "Resume";
    setStatus("paused");

    if (indicator) indicator.freeze();

  } else {
    // снимаем паузу
    core.resumeCapture();
    paused = false;
    pauseBtn.textContent = "Pause";
    setStatus("recording");

    if (indicator) indicator.unfreeze();
  }
}

// ---------- STOP ----------
async function stop() {
  if (!core) return;

  setStatus("stopping…");

  // сбрасываем индикатор
  if (indicator) {
    indicator.baselineOnly(); // baseline, но без freeze()!
  }

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
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  indicator = new MicIndicator(micIndicatorEl);
  indicator.baselineOnly(); // baseline при загрузке

  startBtn.addEventListener("click", start);
  pauseBtn.addEventListener("click", pause);
  stopBtn.addEventListener("click", stop);
});
