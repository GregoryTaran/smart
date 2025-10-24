// ======== Context Module (v1.0 — встраивание без iframe) ========
// Этот модуль рендерит страницу "Context" прямо в <main>, без iframe.
// Файлы модуля лежат в /context/. Требуется recorder-worklet.js рядом с module.js.

export async function render(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2; border-radius:12px; padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎧 Context v1 — Audio → Server → Whisper</h2>
      <div class="controls" style="text-align:center; margin-bottom:10px;">
        <button id="ctx-start" style="padding:10px 20px;border:none;border-radius:8px;background:#4caf50;color:#fff;">Start</button>
        <button id="ctx-stop"  style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>
      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  // ===== Состояние и элементы =====
  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#ctx-start");
  const btnStop  = mount.querySelector("#ctx-stop");

  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
  let ws, audioCtx, worklet, stream;
  let buffer = [];
  let total = 0;
  let lastSend = 0;
  let sampleRate = 44100;
  let sessionId = null;

  function log(msg) {
    const linked = msg.replace(
      /(https?:\/\/[^\s]+)/g,
      (url) => '<a href="' + url + '" target="_blank">' + url + '</a>'
    );
    const line = document.createElement("div");
    line.innerHTML = linked;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
  }

  function logLink(prefix, url, text) {
    const line = document.createElement("div");
    line.append(document.createTextNode(prefix + " "));
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.textContent = text;
    line.appendChild(a);
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(prefix + " " + url);
  }

  // ===== Старт записи =====
  btnStart.onclick = async () => {
    ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (e) => {
      const msg = String(e.data);
      if (msg.startsWith("SESSION:")) {
        sessionId = msg.split(":")[1];
        log('📩 SESSION:' + sessionId);
      } else {
        log('📩 ' + msg);
      }
    };

    ws.onclose = () => log('❌ Disconnected');

    audioCtx = new AudioContext();
    sampleRate = audioCtx.sampleRate;
    log('🎛 Detected SampleRate: ' + sampleRate + ' Hz');
    // recorder-worklet.js лежит в той же папке, поэтому путь такой
    await audioCtx.audioWorklet.addModule('./recorder-worklet.js');

    ws.onopen = () => {
      log('✅ Connected to WebSocket server');
      ws.send(JSON.stringify({ type: 'meta', sampleRate }));
    };

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false }
    });

    const source = audioCtx.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(audioCtx, 'recorder-processor');
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

    log('🎙️ Recording started');
    btnStart.disabled = true;
    btnStop.disabled = false;
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
        log('🫧 Padded last block');
      }
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(full.buffer);
      log('🎧 Sent ' + full.byteLength + ' bytes @ ' + sampleRate + ' Hz');
    }

    buffer = [];
    total = 0;
  }

  // ===== Стоп и цепочка merge → whisper → tts =====
  btnStop.onclick = () => {
    sendBlock(true);
    if (audioCtx) audioCtx.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    log('⏹️ Stopped');
    btnStart.disabled = false;
    btnStop.disabled = true;

    setTimeout(async () => {
      try {
        if (!sessionId) {
          log('❔ Session ID неизвестен — невозможно объединить');
          return;
        }

        log('🧩 Отправляем запрос на объединение...');
        const res = await fetch('/merge?session=' + encodeURIComponent(sessionId));
        if (!res.ok) throw new Error(await res.text());

        const mergedUrl = location.origin + '/' + sessionId + '_merged.wav';
        logLink('💾 Готово:', mergedUrl, mergedUrl);

        // 🧠 Whisper
        log('🧠 Отправляем в Whisper...');
        const w = await fetch('/whisper?session=' + encodeURIComponent(sessionId));
        const data = await w.json();
        if (!w.ok) throw new Error(data?.error || 'Whisper error');
        log('🧠 Whisper → ' + (data.text || ''));

        // 🔊 TTS — озвучка текста
        if (data.text) {
          log('🔊 Отправляем текст в TTS...');
          const ttsRes = await fetch('/tts?session=' + encodeURIComponent(sessionId) + '&text=' + encodeURIComponent(data.text));
          const ttsData = await ttsRes.json();
          if (!ttsRes.ok) throw new Error(ttsData?.error || 'TTS error');
          logLink('🔊 Озвучка:', ttsData.url, ttsData.url);
        }

      } catch (e) {
        log('❌ Ошибка: ' + e.message);
      }
    }, 800);
  };
}
