// === Voice Recorder with SVID integration ===

let ws = null;

async function connectWS(recId) {
  // Берём user_id напрямую из ядра SVID
  const state = (window.SVID && typeof SVID.getState === 'function')
    ? SVID.getState()
    : {};
  const userId = state.user_id || state.visitor_id || "anon";

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws/voicerecorder`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(`START ${JSON.stringify({ user_id: userId, rec_id: recId, ext: ".wav" })}`);
    console.log("🎧 WS connected as", userId);
  };

  ws.onmessage = (ev) => {
    console.log("WS msg:", ev.data);
    try {
      const d = JSON.parse(ev.data);
      if (d.status === "SAVED") {
        const list = document.getElementById("record-list");
        if (list) {
          const li = document.createElement("li");
          li.innerHTML = `<a href="${d.url}" target="_blank">${d.url}</a>`;
          list.prepend(li);
        }
      }
    } catch {}
  };

  ws.onerror = (e) => console.error("WS error:", e);
  ws.onclose = () => console.log("WS closed");
}

segmenter.onSegment = (seg) => {
  if (ws && ws.readyState === 1) seg.blob.arrayBuffer().then(buf => ws.send(buf));
};

async function stopWS() {
  if (ws && ws.readyState === 1) ws.send("END");
  ws = null;
}

// === Integration point in start() ===
// await connectWS(recordingId);
