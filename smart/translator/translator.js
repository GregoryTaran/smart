// Импортируем функцию для работы с тишиной
import { checkSilence } from './silenceHandler.js';

export async function renderTranslator(mount) {
  mount.innerHTML = `...`; // Разметка остается без изменений

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#translator-record-btn");
  const btnStop = mount.querySelector("#ctx-stop");
  const procSel = mount.querySelector("#process-mode");
  const langSel = mount.querySelector("#lang-pair");
  const voiceSel = mount.querySelector("#voice-select");

  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
  let ws, audioCtx, worklet, stream;
  let buffer = [], sessionId = null, sampleRate = 44100, lastSend = Date.now();

  function log(msg) {
    const div = document.createElement("div");
    div.innerHTML = msg.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  btnStart.onclick = async () => {
    try {
      const mode = "agc";
      const processMode = procSel.value;
      const langPair = langSel.value;
      const voice = voiceSel.value;

      btnStart.classList.add("active");
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

      const constraints = {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = audioCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(audioCtx, "recorder-processor");
      source.connect(worklet);

      worklet.port.onmessage = (e) => {
        const chunk = e.data;
        buffer.push(chunk);

        // Используем функцию checkSilence для обработки тишины и отправки чанков
        checkSilence(chunk, ws, processSession); // Здесь передаем chunk, ws, processSession
      };

      log("🎙️ Recording started (AGC)");
      btnStart.disabled = true;
      btnStop.disabled = false;
    } catch (e) {
      btnStart.classList.remove("active");
      log("❌ Ошибка: " + e.message);
    }
  };

  async function processSession() {
    try {
      const voice = voiceSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;

      log("🧩 Объединяем чанки...");
      await fetch(`/merge?session=${sessionId}`);
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
      log("❌ Ошибка: " + e.message);
    }
  }
}
