// ======== Context Module (v1.4 — process chain with GPT modes) ========

export async function render(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2; border-radius:12px; padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎧 Context v1 — Audio → Server → Whisper → GPT → TTS</h2>

      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">Режим захвата:</label>
        <select id="capture-mode" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="raw">🎧 RAW — без обработки</option>
          <option value="agc">🧠 AGC — автоусиление и шумоподавление</option>
          <option value="gain">📢 GAIN — ручное усиление</option>
        </select>
      </div>

      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">Режим обработки:</label>
        <select id="process-mode" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="recognize">🎧 Только распознавание</option>
          <option value="translate">🔤 Перевод через GPT</option>
          <option value="assistant">🤖 Ответ ассистента</option>
        </select>
      </div>

      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">Языковая пара:</label>
        <select id="lang-pair" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
          <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
          <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
          <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
        </select>
      </div>

      <div class="controls" style="text-align:center; margin-bottom:10px;">
        <button id="ctx-start" style="padding:10px 20px;border:none;border-radius:8px;background:#4caf50;color:#fff;">Start</button>
        <button id="ctx-stop"  style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>

      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#ctx-start");
  const btnStop  = mount.querySelector("#ctx-stop");
  const modeSel  = mount.querySelector("#capture-mode");
  const procSel  = mount.querySelector("#process-mode");
  const langSel  = mount.querySelector("#lang-pair");

  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
  let ws, audioCtx, worklet, stream;
  let buffer = [], total = 0, lastSend = 0, sampleRate = 44100, sessionId = null;

  function log(msg) {
    const linked = msg.replace(/(https?:\/\/[^\s]+)/g, (url) => `<a href="${url}" target="_blank">${url}</a>`);
    const line = document.createElement("div");
    line.innerHTML = linked;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
  }
  function logError(err) {
    console.error(err);
    log("❌ Ошибка: " + (err?.message || String(err)));
  }

  btnStart.onclick = async () => {
    try {
      const mode = modeSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;

      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) {
          sessionId = msg.split(":")[1];
          log("📩 SESSION:" + sessionId);
        } else log("📩 " + msg);
      };
      ws.onclose = () => log("❌ Disconnected");

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      log("🎛 Detected SampleRate: " + sampleRate + " Hz");
      await audioCtx.audioWorklet.addModule("context/recorder-worklet.js");

      ws.onopen = () => {
        log("✅ Connected to WebSocket server");
        ws.send(JSON.stringify({ type: "meta", sampleRate, mode, processMode, langPair }));
      };

      const constraints = (mode === "agc")
        ? { audio: { autoGainControl: true, noiseSuppression: true, echoCancellation: true } }
        : { audio: { autoGainControl: false, noiseSuppression: false, echoCancellation: false } };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, "recorder-processor");
      source.connect(worklet);

      const INTERVAL = 2000;
      lastSend = performance.now();

      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        buffer.push(chunk);
        total += chunk.length;
        const now = performance.now();
        if (now - lastSend >= INTERVAL) {
          sendBlock();
          lastSend = now;
        }
      };

      log("🎙️ Recording started");
      btnStart.disabled = true;
      btnStop.disabled = false;
    } catch (err) {
      logError(err);
    }
  };

  function concat(chunks) {
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    const res = new Float32Array(totalLen);
    let offset = 0;
    for (const part of chunks) {
      res.set(part, offset);
      offset += part.length;
    }
    return res;
  }

  function sendBlock(pad = false) {
    if (!buffer.length) return;
    let full = concat(buffer);
    if (pad) {
      const target = Math.round(sampleRate * 2);
      if (full.length < target) {
        const padded = new Float32Array(target);
        padded.set(full);
        full = padded;
        log("🫧 Padded last block");
      }
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(full.buffer);
      log("🎧 Sent " + full.byteLength + " bytes @ " + sampleRate + " Hz");
    }
    buffer = [];
    total = 0;
  }

  btnStop.onclick = () => {
    try {
      sendBlock(true);
      if (audioCtx) audioCtx.close();
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      log("⏹️ Stopped");
      btnStart.disabled = false;
      btnStop.disabled = true;

      // === POST-PROCESS CHAIN ===
      setTimeout(async () => {
        try {
          if (!sessionId) return log("❔ Нет sessionId");

          log("🧩 Объединяем чанки...");
          const merge = await fetch(`/merge?session=${sessionId}`);
          if (!merge.ok) throw new Error(await merge.text());
          const mergedUrl = location.origin + "/" + sessionId + "_merged.wav";
          log(`💾 Файл готов: ${mergedUrl}`);

          log("🧠 Whisper → Распознаём...");
          const w = await fetch(`/whisper?session=${sessionId}`);
          const data = await w.json();
          if (!w.ok) throw new Error(data?.error || "Whisper error");
          const text = data.text || "";
          log("🧠 Whisper → " + text);

          let finalText = text;
          const processMode = procSel.value;
          const langPair = langSel.value;

          if (processMode === "translate" || processMode === "assistant") {
            log("🤖 Отправляем в GPT...");
            const body = {
              text,
              mode: processMode,
              langPair
            };
            const gptRes = await fetch("/gpt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            const gptData = await gptRes.json();
            if (!gptRes.ok) throw new Error(gptData?.error || "GPT error");
            finalText = gptData.text;
            log("🤖 GPT → " + finalText);
          }

          if (finalText) {
            log("🔊 TTS → Озвучка...");
            const tts = await fetch(`/tts?session=${sessionId}&text=${encodeURIComponent(finalText)}`);
            const ttsData = await tts.json();
            if (!tts.ok) throw new Error(ttsData?.error || "TTS error");
            log(`🔊 Готово: ${ttsData.url}`);
          }
        } catch (e) {
          logError(e);
        }
      }, 800);
    } catch (e) {
      logError(e);
    }
  };
}
