// ======== Translator Module (v2.0 — global WS + UI options) ========

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
          <option value="recognize">🎧 Только распознавание</option>
          <option value="translate">🔤 Перевод через GPT</option>
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
        <button id="ctx-stop"
          style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;"
          disabled>Stop</button>
      </div>

      <div id="ctx-log"
        style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;">
      </div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop  = mount.querySelector("#ctx-stop");
  const procSel  = mount.querySelector("#process-mode");
  const langSel  = mount.querySelector("#lang-pair");
  const voiceSel = mount.querySelector("#voice-select");

  function log(msg) {
    const div = document.createElement("div");
    div.innerHTML = msg.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  let ws, audioCtx, worklet, stream;
  let buffer = [], sessionId = null, sampleRate = 48000, lastSend = 0;

  // === глобальный WebSocket ===
  const WS_URL = location.origin.replace(/^http/, "wss");

  btnStart.onclick = async () => {
    try {
      const processMode = procSel.value;
      const langPair = langSel.value;
      const voice = voiceSel.value;
      const mode = "agc";

      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) {
          sessionId = msg.split(":")[1];
          log("📩 " + msg);
        } else log(msg);
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "register",
          module: "translator",
          sampleRate,
        }));
        ws.send(JSON.stringify({
          type: "meta",
          sampleRate,
          mode,
          processMode,
          langPair,
          voice,
        }));
        ws.send("ping-init");
        log("✅ Connected to WebSocket");
      };

      ws.onclose = () => log("❌ Disconnected");

      audioCtx = new AudioContext({ sampleRate });
      await audioCtx.audioWorklet.addModule("smart/context/recorder-worklet.js");
      const source = audioCtx.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({ audio: true }));
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
      log("🎙️ Recording started (AGC)");
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
    log(`🎧 Sent ${full.length} samples`);
  }

  btnStop.onclick = async () => {
    try {
      sendBlock();
      if (audioCtx) audioCtx.close();
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      log("⏹️ Recording stopped");
      btnStart.disabled = false;
      btnStop.disabled = true;

      if (!sessionId) return log("❔ Нет sessionId");
      await processSession();
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  };

  async function processSession() {
    try {
      const voice = voiceSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;

      log("🧩 Объединяем чанки...");
      await fetch(`/translator/merge?session=${sessionId}`);
      log("💾 merged");

      log("🧠 Whisper...");
      const w = await fetch(`/translator/whisper?session=${sessionId}&langPair=${encodeURIComponent(langPair)}`);
      const data = await w.json();
      const text = data.text || "";
      const detectedLang = data.detectedLang || null;
      log("🧠 → " + text);
      log("🌐 Detected language: " + (detectedLang || "none"));

      let finalText = text;
      if (processMode !== "recognize") {
        log("🤖 GPT...");
        const body = { text, mode: processMode, langPair, detectedLang };
        const g = await fetch("/translator/gpt", {
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
        const t = await fetch(`/translator/tts?session=${sessionId}&voice=${voice}&text=${encodeURIComponent(finalText)}`);
        const tData = await t.json();
        log(`🔊 ${tData.url}`);
        const audio = new Audio(tData.url);
        audio.play();
      }
    } catch (e) {
      log("❌ Ошибка: " + e.message);
    }
  }
}
