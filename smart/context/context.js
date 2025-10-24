const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
let ws, audioCtx, worklet, stream;
let buffer = [];
let total = 0;
let lastSend = 0;
let sampleRate = 44100;
let sessionId = null;
const logEl = document.getElementById("log");

// 🔗 Лог с кликабельными ссылками (обычные сообщения)
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

// 🔗 Отдельная функция для правильной ссылки (без html в href)
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

document.getElementById("start").onclick = async () => {
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
  await audioCtx.audioWorklet.addModule('recorder-worklet.js');

  ws.onopen = () => {
    log('✅ Connected to WebSocket server');
    ws.send(JSON.stringify({ type: 'meta', sampleRate }));
  };

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false
    }
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
  document.getElementById('start').disabled = true;
  document.getElementById('stop').disabled = false;
};

function sendBlock(pad = false) {
  if (!buffer.length) return;
  let full = concat(buffer);
  if (pad) {
    const target = Math.round(sampleRate * 2);
    if (full.length < target) {
      const padded = new Float32Array(target);
      padded.set(full);
      full = padded;
      log('🫧 Padded last block (' + (target - full.length) + ' zeros)');
    }
  }

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(full.buffer);
    log('🎧 Sent ' + full.byteLength + ' bytes @ ' + sampleRate + ' Hz');
  }

  buffer = [];
  total = 0;
}

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

document.getElementById('stop').onclick = () => {
  sendBlock(true);
  if (audioCtx) audioCtx.close();
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  log('⏹️ Stopped');
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled = true;

  setTimeout(async () => {
    try {
      if (!sessionId) {
        log('❔ Session ID неизвестен — невозможно объединить');
        return;
      }

      log('🧩 Отправляем запрос на объединение...');
      const res = await fetch('/merge?session=' + encodeURIComponent(sessionId));
      if (!res.ok) throw new Error(await res.text());

      const mergedUrl = 'https://test.smartvision.life/' + sessionId + '_merged.wav';
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
        const ttsRes = await fetch(`/tts?session=${encodeURIComponent(sessionId)}&text=${encodeURIComponent(data.text)}`);
        const ttsData = await ttsRes.json();
        if (!ttsRes.ok) throw new Error(ttsData?.error || 'TTS error');
        logLink('🔊 Озвучка:', ttsData.url, ttsData.url);
      }

    } catch (e) {
      log('❌ Ошибка: ' + e.message);
    }
  }, 1000);
};
