\
// === Voice Recorder (start-gated, with rich logging) ===
// Page does NOTHING until you press Start.

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

const setStatus = (s) => { if (statusEl) statusEl.textContent = s; console.log("🧭 [STATE]", s); };

// ---------- Globals for current session ----------
let core = null;          // SVAudioCore instance
let segmenter = null;     // WavSegmenter instance
let ws = null;            // WebSocket
let recordingId = null;
let paused = false;

// ---------- WS ----------
async function connectWS(recId) {
  const state = (window.SVID && typeof SVID.getState === 'function') ? SVID.getState() : {};
  const userId = state.user_id || state.visitor_id || "anon";

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws/voicerecorder`;
  console.log("🌐 [WS] Connecting to:", url);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("✅ [WS] Connected, sending START");
    ws.send(`START ${JSON.stringify({ user_id: userId, rec_id: recId, ext: ".wav" })}`);
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
  ws.onclose = (ev) => console.log("🛑 [WS] Closed:", ev.code, ev.reason);
}

async function stopWS() {
  if (ws && ws.readyState === 1) {
    console.log("🧹 [WS] Sending END");
    ws.send("END");
  }
  ws = null;
}

// ---------- Lifecycle ----------
async function start() {
  if (core) {
    console.warn("start(): already running"); 
    return;
  }

  // ID for this session
  recordingId = (crypto?.randomUUID?.() || `rec_${Date.now()}`);
  console.log("🎬 [START] recId =", recordingId);
  setStatus("starting…");

  // 1) Init audio core (creates AudioContext, loads worklet)
  core = new SVAudioCore({ chunkSize: 2048, workletUrl: "voicerecorder/audiocore/recorder.worklet.js" });
  await core.init(); // safe: only happens when user pressed Start
  console.log("🎛️ [CORE] AudioContext SR =", core.getContext()?.sampleRate);

  // 2) Init segmenter for exact 2s segments
  segmenter = new WavSegmenter({
    sampleRate: core.getContext()?.sampleRate || 48000,
    segmentSeconds: 2,
    normalize: true,
    emitBlobPerSegment: true,  // so we can send blob directly
    padLastSegment: false
  });
  segmenter.onSegment = (seg) => {
    // Guard: Only send when WS is open
    if (ws && ws.readyState === 1 && seg.blob) {
      console.log("📦 [SEG] send chunk seq", seg.seq, "dur", seg.durationSec.toFixed(2), "blob", seg.blob.size);
      seg.blob.arrayBuffer().then(buf => ws.send(buf)).catch(console.error);
    }
  };

  // 3) Wire frames -> segmenter
  core.onAudioFrame = (f32) => {
    // Each frame comes from worklet at fixed chunkSize (from core) — we just feed segmenter
    segmenter.pushFrame(f32);
  };

  // 4) Open WebSocket AFTER core ready (to have user_id, recId in place)
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
    pauseBtn.textContent = "Resume";
  } else {
    core.resumeCapture();
    paused = false;
    setStatus("recording");
    console.log("▶️ [RESUME]");
    pauseBtn.textContent = "Pause";
  }
}

async function stop() {
  if (!core) return;
  setStatus("stopping…");

  try {
    // Finish last partial
    segmenter?.stop();
  } catch(e){ console.warn(e); }

  await stopWS();

  try { core.stop(); } catch(e){ console.warn(e); }
  core = null;
  segmenter = null;
  recordingId = null;
  paused = false;

  // UI
  startBtn?.removeAttribute("disabled");
  pauseBtn?.setAttribute("disabled", "true");
  stopBtn?.setAttribute("disabled", "true");
  pauseBtn.textContent = "Pause";

  setStatus("idle");
  console.log("🏁 [STOP] done");
}

// ---------- Bind buttons ----------
document.addEventListener("DOMContentLoaded", () => {
  // Important: we do NOTHING here except binding buttons.
  startBtn?.addEventListener("click", start);
  pauseBtn?.addEventListener("click", pause);
  stopBtn?.addEventListener("click", stop);
  console.log("🧷 [BIND] Buttons wired. Waiting for Start…");
});
