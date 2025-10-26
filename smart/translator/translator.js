export async function renderTranslator(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎙️ Переводчик — Суфлёр</h2>
      <button id="translator-record-btn">Start</button>
      <button id="ctx-stop" disabled>Stop</button>
      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");

  const WS_URL = location.origin.replace(/^http/, "wss") + "/translator/ws";
  let ws, audioCtx, worklet, stream;
  let buffer = [], sessionId = null, sampleRate = 44100, lastSend = 0;

  function log(msg) {
    const div = document.createElement("div");
    div.innerHTML = msg.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  btnStart.onclick = async () => {
    try {
      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) sessionId = msg.split(":")[1];
        log("📩 " + msg);
      };
      ws.onclose = () => log("❌ Disconnected");

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      await audioCtx.audioWorklet.addModule("translator/recorder-worklet.js");

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "meta", sampleRate }));
        log("✅ Connected to WebSocket");
      };

      const constraints = { audio: true };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, "recorder-processor");
      source.connect(worklet);

      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        buffer.push(chunk);
        const now = performance.now();
        if (now - lastSend >= 1000) {
          sendBlock();
          lastSend = now;
        }
      };

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

  function sendBlock() {
    if (!buffer.length || !ws || ws.readyState !== WebSocket.OPEN) return;
    const full = concat(buffer);
    ws.send(full.buffer);
    buffer = [];
  }

  btnStop.onclick = async () => {
    sendBlock();
    if (audioCtx) audioCtx.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    btnStart.disabled = false;
    btnStop.disabled = true;
    log("⏹️ Recording stopped");
    await processSession();
  };

  async function processSession() {
    if (!sessionId) return log("❔ Нет sessionId");
    log("🧩 Объединяем чанки...");
    await fetch(`/translator/merge?session=${sessionId}`);
    const mergedUrl = location.origin + `/smart/translator/tmp/${sessionId}_merged.wav`;
    log("💾 " + mergedUrl);
    log("🧠 Whisper...");
    const w = await fetch(`/translator/whisper?session=${sessionId}&langPair=en-ru`);
    const data = await w.json();
    log("🧠 → " + (data.text || ""));
  }
}
