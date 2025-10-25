// ======== Translator Module (v3.0 — клиент решает когда обрабатывать) ========

export async function renderTranslator(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
      <h2>🎙️ Переводчик — Суфлёр</h2>
      <div style="text-align:center;margin-bottom:10px;">
        <button id="translator-record-btn">Start</button>
        <button id="ctx-stop" disabled>Stop</button>
      </div>
      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;

  // ---- STATE -------------------------------------------------------------
  let state = "idle";
  let ws, audioCtx, worklet, stream;
  let buffer = [];
  let sessionId = null, sampleRate = 44100;
  let lastVoiceTs = 0;
  let silenceTimer = null;
  const SILENCE_MS = 2000;     // 2 секунды тишины = конец фразы
  const SEND_EVERY_MS = 1000;  // отправляем чанки раз в секунду
  const VOICE_RMS = 0.01;
  let lastSend = 0;

  function log(msg) {
    const div = document.createElement("div");
    div.innerHTML = msg.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function rms(frame) {
    let s = 0;
    for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
    return Math.sqrt(s / frame.length);
  }

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

  function sendBlock(force = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (!force && now - lastSend < SEND_EVERY_MS) return;
    if (!buffer.length) return;

    const full = concat(buffer);
    ws.send(full.buffer);
    buffer = [];
    lastSend = now;
    log(`🎧 Sent ${full.length} samples`);
  }

  async function processSegment() {
    try {
      if (!sessionId) return log("❔ Нет sessionId");

      log("🧩 Объединяем чанки сегмента...");
      await fetch(`/merge?session=${sessionId}&clean=1`);
      const mergedUrl = location.origin + "/" + sessionId + "_merged.wav";
      log("💾 " + mergedUrl);

      log("🧠 Whisper...");
      const w = await fetch(`/whisper?session=${sessionId}&langPair=en-ru`);
      const data = await w.json();
      const text = data.text || "";
      const detectedLang = data.detectedLang || null;
      log("🧠 → " + text);
      log("🌐 Detected language: " + (detectedLang || "none"));

      log("🤖 GPT...");
      const body = { text, mode: "translate", langPair: "en-ru", detectedLang };
      const g = await fetch("/gpt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const gData = await g.json();
      const finalText = gData.text;
      log("🤖 → " + finalText);

      if (finalText) {
        log("🔊 TTS...");
        const t = await fetch(`/tts?session=${sessionId}&text=${encodeURIComponent(finalText)}`);
        const tData = await t.json();
        log(`🔊 ${tData.url}`);
      }
    } catch (e) {
      log("❌ Segment error: " + e.message);
    }
  }

  btnStart.onclick = async () => {
    if (state !== "idle") return;
    try {
      state = "recording";
      btnStart.disabled = true;
      btnStop.disabled = false;

      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) sessionId = msg.split(":")[1];
        log("📩 " + msg);
      };

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      await audioCtx.audioWorklet.addModule("translator/recorder-worklet.js");

      const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, "recorder-processor");
      source.connect(worklet);

      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        buffer.push(chunk);
        const level = rms(chunk);
        const now = performance.now();

        // 💬 активность голоса
        if (level >= VOICE_RMS) {
          lastVoiceTs = now;
          if (silenceTimer) clearTimeout(silenceTimer);
        } else {
          // 💭 если тишина держится 2 секунды → отправляем сигнал на обработку
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              sendBlock(true);
              processSegment(); // ⏩ клиент решает, когда обрабатывать
              silenceTimer = null;
            }, SILENCE_MS);
          }
        }

        if (now - lastSend >= SEND_EVERY_MS) sendBlock();
      };

      log(`🎛 SampleRate: ${sampleRate} Hz`);
      log("🎙️ Recording started (AGC, continuous)");
    } catch (e) {
      log("❌ Ошибка: " + e.message);
      state = "idle";
    }
  };

  btnStop.onclick = async () => {
    if (state !== "recording") return;
    state = "idle";
    btnStart.disabled = false;
    btnStop.disabled = true;
    sendBlock(true);
    if (audioCtx) audioCtx.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    log("⏹️ Recording stopped");
  };
}
