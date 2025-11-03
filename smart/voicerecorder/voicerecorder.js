// smart/voicerecorder/voicerecorder.js
(() => {
  const CONTAINER_SELECTOR = '#main[data-module="voicerecorder"]';
  const container = document.querySelector(CONTAINER_SELECTOR);
  if (!container) return; // module not present on page

  // constants
  const CHUNK_SECONDS = 2;
  const SAMPLE_RATE = 48000;
  const CHANNELS = 1;
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/voicerecorder`;

  // find elements inside container only
  const btnStart = container.querySelector('#vc-btn-start');
  const btnPause = container.querySelector('#vc-btn-pause');
  const btnStop  = container.querySelector('#vc-btn-stop');
  const statusEl = container.querySelector('#vc-status');
  const audioEl  = container.querySelector('#vc-audio');
  const downloadLink = container.querySelector('#vc-download');
  const shareBtn = container.querySelector('#vc-share');
  const transcriptText = container.querySelector('#vc-transcript');
  const vuCanvas = container.querySelector('#vc-vu');
  const vuCtx = vuCanvas && vuCanvas.getContext ? vuCanvas.getContext('2d') : null;
  const levelDot = container.querySelector('#vc-level');

  // small safety checks
  if (!btnStart || !btnPause || !btnStop || !statusEl) {
    console.warn('Voicerecorder: missing required DOM elements');
    return;
  }

  // state
  let ws = null;
  let mediaStream = null;
  let audioCtx = null;
  let processorNode = null;
  let sourceNode = null;
  let recording = false;
  let paused = false;
  let floatBuffer = [];
  let floatBufferLen = 0;
  let seq = 0;
  let sessionId = null;

  function ensureSession() {
    sessionId = localStorage.getItem('sv_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + (Date.now().toString(36)) + '_' + Math.random().toString(36).slice(2,9);
      localStorage.setItem('sv_session_id', sessionId);
    }
    return sessionId;
  }
  ensureSession();

  function logStatus(s) { if (statusEl) statusEl.textContent = s; }

  function setupWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => logStatus('WS connected');
    ws.onclose = () => logStatus('WS disconnected');
    ws.onerror = (e) => console.error('ws err', e);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'result') {
          if (data.mp3_url && audioEl) {
            audioEl.src = data.mp3_url;
            if (downloadLink) {
              downloadLink.href = data.mp3_url;
              downloadLink.download = `${sessionId}__record.mp3`;
            }
            if (shareBtn) shareBtn.disabled = false;
          }
          if (data.transcript && transcriptText) transcriptText.textContent = data.transcript;
          logStatus('Готово: результат получен');
        } else if (data.type === 'error') {
          logStatus('Ошибка сервера: ' + (data.message || ''));
        }
      } catch (err) { console.warn('ws msg parse fail', err); }
    };
  }

  async function startRecording() {
    ensureSession();
    setupWebSocket();

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: CHANNELS }});
    } catch (err) {
      console.error('getUserMedia error', err);
      logStatus('Ошибка доступа к микрофону');
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);

    // try AudioWorklet
    if (audioCtx.audioWorklet) {
      try {
        await audioCtx.audioWorklet.addModule('/voicerecorder/audioworklet-processor.js');
        processorNode = new AudioWorkletNode(audioCtx, 'chunker-processor');
        processorNode.port.onmessage = (e) => {
          if (e.data && e.data.type === 'level') drawLevel(e.data.rms);
        };
        sourceNode.connect(processorNode);
        // keep chain alive with a silent destination connection only if needed
        try { processorNode.connect(audioCtx.destination); } catch(e) {}
      } catch (err) {
        console.warn('AudioWorklet load failed', err);
      }
    }

    // fallback: ScriptProcessor
    if (!processorNode) {
      const bufferSize = 4096;
      const scriptNode = audioCtx.createScriptProcessor(bufferSize, CHANNELS, CHANNELS);
      scriptNode.onaudioprocess = (audioProcessingEvent) => {
        if (!recording || paused) return;
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);
        floatBuffer.push(new Float32Array(channelData));
        floatBufferLen += channelData.length;
        drawLevel(calcRMS(channelData));
        tryFlushChunks();
      };
      sourceNode.connect(scriptNode);
      scriptNode.connect(audioCtx.destination);
      processorNode = scriptNode;
    }

    recording = true;
    paused = false;
    seq = 0;
    floatBuffer = [];
    floatBufferLen = 0;

    const startMsg = { type: 'start', session_id: sessionId, user_id: sessionId, sample_rate: SAMPLE_RATE, channels: CHANNELS, format: 'float32' };
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(startMsg));
    else ws.addEventListener('open', () => ws.send(JSON.stringify(startMsg)), { once: true });

    btnStart.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled = false;
    logStatus('Запись ...');
  }

  function calcRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  function drawLevel(rms) {
    if (!vuCtx || !vuCanvas) return;
    vuCtx.clearRect(0,0,vuCanvas.width, vuCanvas.height);
    const h = vuCanvas.height * Math.min(1, rms * 10);
    vuCtx.fillStyle = '#22c55e';
    vuCtx.fillRect(0, vuCanvas.height - h, vuCanvas.width, h);
    if (levelDot) {
      const col = Math.min(255, Math.round(200 * Math.min(1, rms*15)));
      levelDot.style.background = `rgb(${255-col}, ${50+col}, ${50})`;
    }
  }

  function tryFlushChunks() {
    const needed = SAMPLE_RATE * CHUNK_SECONDS;
    if (floatBufferLen >= needed) {
      const out = new Float32Array(needed);
      let offset = 0;
      while (offset < needed && floatBuffer.length) {
        const chunk = floatBuffer.shift();
        const need = Math.min(chunk.length, needed - offset);
        out.set(chunk.subarray(0, need), offset);
        if (need < chunk.length) {
          floatBuffer.unshift(chunk.subarray(need));
        }
        offset += need;
        floatBufferLen -= need;
      }
      const meta = { type: 'chunk_meta', seq: seq++, duration_ms: CHUNK_SECONDS * 1000, sample_rate: SAMPLE_RATE, bytes: out.byteLength };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(meta));
        ws.send(out.buffer);
      }
    }
  }

  async function stopRecording() {
    if (!recording) return;
    if (floatBufferLen > 0) {
      let total = 0; for (const b of floatBuffer) total += b.length;
      const out = new Float32Array(total);
      let off = 0;
      for (const b of floatBuffer) { out.set(b, off); off += b.length; }
      const meta = { type: 'chunk_meta', seq: seq++, duration_ms: Math.round((total / SAMPLE_RATE) * 1000), sample_rate: SAMPLE_RATE, bytes: out.byteLength };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(meta));
        ws.send(out.buffer);
      }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', session_id: sessionId }));
    }

    try { processorNode && processorNode.disconnect && processorNode.disconnect(); } catch(e){}
    try { sourceNode && sourceNode.disconnect && sourceNode.disconnect(); } catch(e){}
    try { audioCtx && audioCtx.close && audioCtx.close(); } catch(e){}
    try { mediaStream && mediaStream.getTracks && mediaStream.getTracks().forEach(t => t.stop()); } catch(e){}

    recording = false;
    paused = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
    logStatus('Остановка записи — ожидаем обработку...');
  }

  function pauseRecording() {
    paused = true;
    btnPause.textContent = 'RESUME';
    logStatus('Запись приостановлена');
  }

  function resumeRecording() {
    paused = false;
    btnPause.textContent = 'ПАУЗА';
    logStatus('Запись продолжается');
  }

  // bind events
  btnStart.addEventListener('click', () => startRecording());
  btnPause.addEventListener('click', () => {
    if (!recording) return;
    if (!paused) pauseRecording(); else resumeRecording();
  });
  btnStop.addEventListener('click', () => stopRecording());

  if (shareBtn) shareBtn.addEventListener('click', () => {
    alert('Share: пример — можно сгенерировать временную ссылку на сервере. Реализация по запросу.');
  });

  window.addEventListener('beforeunload', () => { if (ws) ws.close(); });
})();
