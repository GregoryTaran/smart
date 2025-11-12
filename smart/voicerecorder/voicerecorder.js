// === Voice Recorder (версия с логированием) ===

import SVAudioCore from "./audiocore/sv-audio-core.js";
import WavSegmenter from "./audiocore/wav-segmenter.js";
import WavAssembler from "./audiocore/wav-assembler.js"; // опционально

// === WebSocket блок с интеграцией SVID и логированием ===
let ws = null;

async function connectWS(recId) {
  console.log("🎧 [WS] Preparing connection for recId:", recId);
  const state = (window.SVID && typeof SVID.getState === 'function')
    ? SVID.getState()
    : {};
  const userId = state.user_id || state.visitor_id || "anon";
  console.log("🧠 [SVID] userId =", userId);

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
        const list = document.getElementById("record-list");
        if (list) {
          const li = document.createElement("li");
          li.innerHTML = `<a href="${d.url}" target="_blank">${d.url}</a>`;
          list.prepend(li);
        }
      }
    } catch (err) {
      console.warn("⚠️ [WS] Non-JSON message:", ev.data);
    }
  };

  ws.onerror = (e) => console.error("❌ [WS] Error:", e);
  ws.onclose = (ev) => console.log("🛑 [WS] Closed:", ev.code, ev.reason);
}

// === Безопасное подключение segmenter ===
function attachSegmenterHandler() {
  if (typeof segmenter !== "undefined" && segmenter && typeof segmenter.onSegment !== "undefined") {
    console.log("🎙️ [Segmenter] Handler attached");
    segmenter.onSegment = (seg) => {
      console.log("📦 [Segmenter] Sending chunk, size:", seg.blob.size);
      if (ws && ws.readyState === 1) seg.blob.arrayBuffer().then(buf => ws.send(buf));
    };
  } else {
    console.log("⏳ [Segmenter] Waiting to attach...");
    setTimeout(attachSegmenterHandler, 300);
  }
}
attachSegmenterHandler();

async function stopWS() {
  if (ws && ws.readyState === 1) {
    console.log("🧹 [WS] Sending END");
    ws.send("END");
  }
  ws = null;
  console.log("🧩 [WS] Connection reset");
}

// === Пример вызова в start() ===
// await connectWS(recordingId);
