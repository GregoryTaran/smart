// ======== Translator Module (v2.1 — чанки 1 секунда, стабильная отправка) ========

export async function renderTranslator(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2;border-radius:12px;padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎙️ Переводчик — Суфлёр</h2>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">🧑 Голос озвучки:</label>
        <select id="voice-select" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="alloy">Alloy (универсальный)</option>
          <option value="verse">Verse (бархатный мужской)</option>
          <option value="echo">Echo (низкий тембр)</option>
          <option value="breeze">Breeze (лёгкий мужской)</option>
          <option value="coral">Coral (мягкий мужской)</option>
          <option value="astra">Astra (женский)</option>
        </select>
      </div>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">Режим обработки:</label>
        <select id="process-mode" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="translate">🔤 Перевод через GPT</option>
          <option value="recognize">🎧 Только распознавание</option>
          <option value="assistant">🤖 Ответ ассистента</option>
        </select>
      </div>

      <div style="text-align:center;margin-bottom:10px;">
        <label style="font-weight:600;">Языковая пара:</label>
        <select id="lang-pair" style="margin-left:8px;padding:6px 10px;border-radius:6px;">
          <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
          <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
          <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
          <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
        </select>
      </div>

      <div style="text-align:center;margin-bottom:10px;">
        <button id="translator-record-btn">Start</button>
        <button id="ctx-stop" style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>

      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const procSel = mount.querySelector("#process-mode");
  const langSel = mount.querySelector("#lang-pair");
  const voiceSel = mount.querySelector("#voice-select");

  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;

  // ---- STATE -------------------------------------------------------------
  let state = "idle";
  let ws, audioCtx, worklet, stream;
  let buffer = [];
  let sessionId = null, sampleRate = 44100;
  let lastVoiceTs = 0;
  let processing = false;
  const SILENCE_MS = 2000;
  const SEND_EVERY_MS = 1000; // ⭐ отправляем чанки раз в секунду
  const VOICE_RMS = 0.01;
  let lastSend = 0;

  function setState(next) {
    state = next;
    if (state === "recording") {
      btnStart.classList.add("active");
      btnStart.disabled = true;
      btnStop.disabled = false;
    } else if (state === "idle") {
      btnStart.classList.remove("active");
      btnStart.disabled = false;
      btnStop.disabled = true;
    }
  }

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

  btnStart.onclick = async () => {
    if (state !== "idle") return;
    try {
      setState("recording");
      const mode = "agc";
      const processMode = procSel.value;
      const langPair = langSel.value;
      const voice = voiceSel.value;

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
      log("🎛 SampleRate: " + sampleRate + " Hz");

      await audioCtx.audioWorklet.addModule("translator/recorder-worklet.js");

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "meta", sampleRate, mode, processMode, langPair, voice }));
        log("✅ Connected to WebSocket");
      };

      const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, "recorder-processor");
      source.connect(worklet);

      lastVoiceTs = performance.now();
      processing = false;

      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        buffer.push(chunk);

        const level = rms(chunk);
        const now = performance.now();
        if (level >= VOICE_RMS) lastVoiceTs = now;

        // ⭐ обновлено — отправка чанков строго раз в 1 секунду
        if (now - lastSend >= SEND_EVERY_MS) sendBlock();

        if (!processing && now - lastVoiceTs >= SILENCE_MS) {
          processing = true;
          sendBlock(true);
          processSegment().finally(() => {
            lastVoiceTs = performance.now();
            processing = false;
          });
        }
      };

      log("🎙️ Recording started (AGC, continuous)");
    } catch (e) {
      setState("idle");
      log("❌ Ошибка: " + e.message);
    }
  };

  btnStop.onclick = async () => {
    if (state !== "recording") return;
    try {
      setState("idle");
      sendBlock(true);
      if (audioCtx) audioCtx.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      log("⏹️ Recording stopped");
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

  async function processSegment() {
    try {
      if (!sessionId) return log("❔ Нет sessionId");
      const voice = voiceSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;

      log("🧩 Объединяем чанки сегмента...");
      await fetch(`/merge?session=${sessionId}&clean=1`);
      const mergedUrl = location.origin + "/" + sessionId + "_merged.wav";
      log("💾 " + mergedUrl);

      log("🧠 Whisper...");
      const w = await fetch(`/whisper?session=${sessionId}&langPair=${encodeURIComponent(langPair)}`);
      const data = await w.json();
      const text = data.text || "";
      const detectedLang = data.detectedLang || null;
      log("🧠 → " + text);
      log("🌐 Detected language: " + (detectedLang || "none"));

      let finalText = text;
      if (processMode !== "recognize") {
        log("🤖 GPT...");
        const body = { text, mode: processMode, langPair, detectedLang };
        const g = await fetch("/gpt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const gData = await g.json();
        finalText = gData.text;
        log("🤖 → " + finalText);
      }

      if (finalText) {
        log("🔊 TTS...");
        const t = await fetch(`/tts?session=${sessionId}&voice=${voice}&text=${encodeURIComponent(finalText)}`);
        const tData = await t.json();
        log(`🔊 ${tData.url}`);
      }
    } catch (e) {
      log("❌ Segment error: " + e.message);
    }
  }
}
