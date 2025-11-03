// smart/voicerecorder/voicerecorder.js
// (Полный файл — только фрагменты изменены: stopRecording + worklet message handling + flush)

(() => {
  const CONTAINER = document.querySelector('#main[data-module="voicerecorder"]');
  if (!CONTAINER) return;

  const BTN_START = CONTAINER.querySelector('#vc-btn-start');
  const BTN_PAUSE = CONTAINER.querySelector('#vc-btn-pause');
  const BTN_STOP  = CONTAINER.querySelector('#vc-btn-stop');
  const STATUS    = CONTAINER.querySelector('#vc-status');
  const AUDIO_EL  = CONTAINER.querySelector('#vc-audio');
  const DOWNLOAD  = CONTAINER.querySelector('#vc-download');
  const TRANSCRIPT= CONTAINER.querySelector('#vc-transcript');
  const VU_CANVAS = CONTAINER.querySelector('#vc-vu');
  const VU_CTX    = VU_CANVAS ? VU_CANVAS.getContext('2d') : null;
  const LEVEL_DOT = CONTAINER.querySelector('#vc-level');

  const CHUNK_SECONDS = 2;
  const SAMPLE_RATE = 48000;
  const CHANNELS = 1;

  let audioCtx = null;
  let sourceNode = null;
  let processorNode = null;
  let mediaStream = null;
  let recording = false;
  let paused = false;
  let seq = 0;
  let sessionId = null;

  let ws = null;
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/voicerecorder`;
  let pendingQueue = [];
  let wsOpen = false;

  let floatBufferParts = [];
  let floatBufferLen = 0;

  function ensureSession() {
    sessionId = localStorage.getItem('sv_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
      localStorage.setItem('sv_session_id', sessionId);
    }
    return sessionId;
  }

  function logStatus(s) { if (STATUS) STATUS.textContent = s; }

  function setupWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { wsOpen = true; logStatus('WS connected'); flushPendingQueue(); };
    ws.onclose = () => { wsOpen = false; logStatus('WS disconnected'); };
    ws.onerror = (e) => { console.error('ws error', e); logStatus('WS error'); };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'result') {
          if (data.mp3_url && AUDIO_EL) {
            AUDIO_EL.src = data.mp3_url;
            if (DOWNLOAD) { DOWNLOAD.href = data.mp3_url; DOWNLOAD.download = `${sessionId}__record.mp3`; }
          }
          if (data.transcript && TRANSCRIPT) TRANSCRIPT.textContent = data.transcript;
          logStatus('Готово: результат получен');
        } else if (data.type === 'processing') {
          logStatus('Ожидайте, идёт обработка...');
        } else if (data.type === 'started') {
          logStatus('Сессия ' + (data.session_id || '') + ' запущена');
        } else if (data.type === 'error') {
          logStatus('Ошибка сервера: ' + (data.message || ''));
        }
      } catch (err) { /* ignore non-json */ }
    };
  }

  function queueChunk(meta, buffer) { pendingQueue.push({ meta, buffer }); if (pendingQueue.length > 50) pendingQueue.shift(); }

  function flushPendingQueue() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (pendingQueue.length) {
      const item = pendingQueue.shift();
      try {
        ws.send(JSON.stringify(item.meta));
        ws.send(item.buffer);
      } catch (e) {
        console.warn('flush send failed, requeue', e);
        pendingQueue.unshift(item);
        break;
      }
    }
  }

  function sendChunkOverWs(float32Array) {
    const meta = { type: 'chunk_meta', seq: seq++, duration_ms: Math.round((float32Array.length / SAMPLE_RATE) * 1000), sample_rate: SAMPLE_RATE, channels: CHANNELS, bytes: float32Array.byteLength };
    const buffer = float32Array.buffer;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(meta)); ws.send(buffer); }
      catch (e) { console.warn('ws send failed, queueing', e); queueChunk(meta, buffer.slice(0)); }
    } else {
      queueChunk(meta, buffer.slice(0));
      setupWebSocket();
    }
  }

  function drawLevel(rms) {
    if (!VU_CTX || !VU_CANVAS) return;
    const w = VU_CANVAS.width, h = VU_CANVAS.height;
    VU_CTX.clearRect(0, 0, w, h);
    const level = Math.min(1, rms * 15);
    const fillH = Math.round(h * level);
    VU_CTX.fillStyle = '#22c55e';
    VU_CTX.fillRect(0, h - fillH, w, fillH);
    if (LEVEL_DOT) {
      const col = Math.min(255, Math.round(200 * level));
      LEVEL_DOT.style.background = `rgb(${255-col}, ${50+col}, ${50})`;
    }
  }

  function calcRMS(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  function tryFlushScriptChunks() {
    const needed = SAMPLE_RATE * CHUNK_SECONDS;
    if (floatBufferLen >= needed) {
      const out = new Float32Array(needed);
      let off = 0;
      while (off < needed && floatBufferParts.length) {
        const chunk = floatBufferParts.shift();
        const take = Math.min(chunk.length, needed - off);
        out.set(chunk.subarray(0, take), off);
        if (take < chunk.length) floatBufferParts.unshift(chunk.subarray(take));
        off += take;
        floatBufferLen -= take;
      }
      sendChunkOverWs(out);
    }
  }

  async function startRecording() {
    ensureSession();
    setupWebSocket();

    try { mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: CHANNELS }}); }
    catch (err) { console.error('getUserMedia error', err); logStatus('Ошибка доступа к микрофону'); return; }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);

    seq = 0; floatBufferParts = []; floatBufferLen = 0; pendingQueue = [];

    let usedWorklet = false;
    if (audioCtx.audioWorklet) {
      try {
        await audioCtx.audioWorklet.addModule('/voicerecorder/audioworklet-processor.js');
        const node = new AudioWorkletNode(audioCtx, 'chunker-processor');
        processorNode = node;
        node.port.postMessage({ type: 'set_chunk_seconds', value: CHUNK_SECONDS });

        node.port.onmessage = (e) => {
          const d = e.data;
          if (!d) return;
          if (d.type === 'level') drawLevel(d.rms);
          else if (d.type === 'chunk' && d.buffer) {
            try { const floatBuf = new Float32Array(d.buffer); sendChunkOverWs(floatBuf); }
            catch (err) { console.warn('Failed to handle worklet chunk', err); }
          }
        };

        try {
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0;
          node.connect(silentGain);
          silentGain.connect(audioCtx.destination);
        } catch (e) {}

        sourceNode.connect(node);
        usedWorklet = true;
        logStatus('Recording (worklet) ...');
      } catch (err) {
        console.warn('AudioWorklet unavailable / failed, falling back', err);
        usedWorklet = false;
      }
    }

    if (!usedWorklet) {
      const bufferSize = 4096;
      const scriptNode = audioCtx.createScriptProcessor(bufferSize, CHANNELS, CHANNELS);
      scriptNode.onaudioprocess = (audioProcessingEvent) => {
        if (!recording || paused) return;
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const ch = inputBuffer.getChannelData(0);
        floatBufferParts.push(new Float32Array(ch));
        floatBufferLen += ch.length;
        drawLevel(calcRMS(ch));
        tryFlushScriptChunks();
      };
      sourceNode.connect(scriptNode);
      try {
        const g = audioCtx.createGain();
        g.gain.value = 0;
        scriptNode.connect(g);
        g.connect(audioCtx.destination);
      } catch (e) {}
      processorNode = scriptNode;
      logStatus('Recording (script) ...');
    }

    const startMsg = { type: 'start', session_id: sessionId, user_id: sessionId, sample_rate: SAMPLE_RATE, channels: CHANNELS, format: 'float32' };
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(startMsg));
    else if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify(startMsg)), { once: true });
    else setupWebSocket();

    recording = true; paused = false;
    if (BTN_START) BTN_START.disabled = true;
    if (BTN_PAUSE) BTN_PAUSE.disabled = false;
    if (BTN_STOP) BTN_STOP.disabled = false;
  }

  function pauseRecording() {
    if (!recording) return;
    paused = true;
    if (BTN_PAUSE) BTN_PAUSE.textContent = 'RESUME';
    logStatus('Запись приостановлена');
  }

  function resumeRecording() {
    if (!recording) return;
    paused = false;
    if (BTN_PAUSE) BTN_PAUSE.textContent = 'ПАУЗА';
    logStatus('Запись продолжается');
  }

  async function stopRecording() {
    if (!recording) return;

    // If using worklet, ask it to flush partial buffer
    try {
      if (processorNode && processorNode.port && typeof processorNode.port.postMessage === 'function') {
        try {
          processorNode.port.postMessage({ type: 'flush' });
          // small wait to allow worklet to post the chunk to main thread
          await new Promise(r => setTimeout(r, 180));
        } catch (e) {
          console.warn('worklet flush failed', e);
        }
      }
      // also flush any partial ScriptProcessor buffer
      if (floatBufferLen > 0 && floatBufferParts.length) {
        let total = 0;
        for (const p of floatBufferParts) total += p.length;
        const out = new Float32Array(total);
        let off = 0;
        for (const p of floatBufferParts) { out.set(p, off); off += p.length; }
        sendChunkOverWs(out);
        floatBufferParts = [];
        floatBufferLen = 0;
      }
    } catch (e) {
      console.warn('flush overall failed', e);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', session_id: sessionId }));
    } else {
      setupWebSocket();
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'stop', session_id: sessionId })), { once: true });
    }

    try { processorNode && processorNode.disconnect && processorNode.disconnect(); } catch (e) {}
    try { sourceNode && sourceNode.disconnect && sourceNode.disconnect(); } catch (e) {}
    try { audioCtx && audioCtx.close && audioCtx.close(); } catch (e) {}
    try { mediaStream && mediaStream.getTracks && mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}

    recording = false; paused = false;
    if (BTN_START) BTN_START.disabled = false;
    if (BTN_PAUSE) { BTN_PAUSE.disabled = true; BTN_PAUSE.textContent = 'ПАУЗА'; }
    if (BTN_STOP) BTN_STOP.disabled = true;
    logStatus('Остановка записи — ожидаем обработку...');
  }

  if (BTN_START) BTN_START.addEventListener('click', () => startRecording());
  if (BTN_PAUSE) BTN_PAUSE.addEventListener('click', () => { if (!recording) return; if (!paused) pauseRecording(); else resumeRecording(); });
  if (BTN_STOP) BTN_STOP.addEventListener('click', () => stopRecording());

  window.addEventListener('beforeunload', () => { try { if (ws) ws.close(); } catch (e) {} });

  if (BTN_PAUSE) BTN_PAUSE.disabled = true;
  if (BTN_STOP) BTN_STOP.disabled = true;
  logStatus('Готов');
})();
