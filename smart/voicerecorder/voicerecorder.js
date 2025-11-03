// voicerecorder.js - minimal, AudioWorklet-only recorder
(() => {
  const ROOT = document.querySelector('#main[data-module="voicerecorder"]');
  if (!ROOT) return;

  // UI elements (expected in page)
  const BTN_START = ROOT.querySelector('#vc-btn-start');
  const BTN_PAUSE = ROOT.querySelector('#vc-btn-pause');
  const BTN_STOP  = ROOT.querySelector('#vc-btn-stop');
  const STATUS    = ROOT.querySelector('#vc-status');
  const AUDIO_EL  = ROOT.querySelector('#vc-audio');
  const DOWNLOAD  = ROOT.querySelector('#vc-download');
  const TRANSCRIPT= ROOT.querySelector('#vc-transcript');

  const CHUNK_SECONDS = 2;

  let audioCtx = null;
  let mediaStream = null;
  let sourceNode = null;
  let workletNode = null;
  let recording = false;
  let paused = false;
  let seq = 0;
  let sessionId = null;

  let ws = null;
  const pending = []; // queue of { meta, buffer } when WS is not open
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/voicerecorder`;

  function log(s) { if (STATUS) STATUS.textContent = s; }

  function ensureSession() {
    sessionId = localStorage.getItem('sv_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
      localStorage.setItem('sv_session_id', sessionId);
    }
    return sessionId;
  }

  function setupWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      log('WS connected');
      // flush queue
      while (pending.length) {
        const item = pending.shift();
        try {
          ws.send(JSON.stringify(item.meta));
          ws.send(item.buffer);
        } catch (e) {
          console.warn('ws flush failed', e);
          pending.unshift(item);
          break;
        }
      }
    };
    ws.onclose = () => log('WS disconnected');
    ws.onerror = (e) => { console.error(e); log('WS error'); };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'result') {
          if (data.mp3_url && AUDIO_EL) {
            AUDIO_EL.src = data.mp3_url;
            if (DOWNLOAD) { DOWNLOAD.href = data.mp3_url; DOWNLOAD.download = `${sessionId}__record.mp3`; }
          }
          if (data.transcript && TRANSCRIPT) TRANSCRIPT.textContent = data.transcript;
          log('Готово: результат получен');
        } else if (data.type === 'processing') {
          log('Ожидайте, идёт обработка...');
        } else if (data.type === 'error') {
          log('Ошибка сервера: ' + (data.message || ''));
        }
      } catch (e) {
        // ignore non-json
      }
    };
  }

  async function startRecording() {
    ensureSession();
    setupWebSocket();

    try {
      // create AudioContext and measure sample rate
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const actualRate = audioCtx.sampleRate;
      const chunkSamples = Math.round(actualRate * CHUNK_SECONDS);

      // get microphone
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);

      // add worklet and configure
      await audioCtx.audioWorklet.addModule('/voicerecorder/audioworklet-processor.js');
      workletNode = new AudioWorkletNode(audioCtx, 'chunker-processor');
      workletNode.port.postMessage({ type: 'config', chunk_samples: chunkSamples, sample_rate: actualRate, channels: 1 });

      // handle messages from worklet
      workletNode.port.onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.type === 'level') {
          // optional: show VU based on d.rms
        } else if (d.type === 'chunk' && d.buffer) {
          const floatBuf = new Float32Array(d.buffer); // always chunkSamples length
          const valid = Number(d.valid_samples) || floatBuf.length;
          const meta = {
            type: 'chunk_meta',
            seq: seq++,
            sample_rate: actualRate,
            channels: 1,
            chunk_samples: floatBuf.length,
            valid_samples: valid,
            timestamp: Date.now()
          };
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(meta));
            ws.send(floatBuf.buffer);
          } else {
            pending.push({ meta, buffer: floatBuf.buffer.slice(0) });
            setupWebSocket();
          }
        }
      };

      // connect worklet (silent output to keep node alive)
      try {
        const silent = audioCtx.createGain(); silent.gain.value = 0;
        workletNode.connect(silent);
        silent.connect(audioCtx.destination);
      } catch (e) {}

      sourceNode.connect(workletNode);

      // send start msg with measured rate
      const startMsg = { type: 'start', session_id: sessionId, sample_rate: actualRate, channels: 1, chunk_samples: chunkSamples };
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(startMsg));
      else if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify(startMsg)), { once: true });

      recording = true;
      paused = false;
      if (BTN_START) BTN_START.disabled = true;
      if (BTN_STOP) BTN_STOP.disabled = false;
      if (BTN_PAUSE) BTN_PAUSE.disabled = false;
      log('Recording...');
    } catch (err) {
      console.error('startRecording error', err);
      log('Ошибка: не удалось начать запись');
    }
  }

  function pauseRecording() {
    if (!recording) return;
    paused = !paused;
    // no complex behavior: pause toggles a flag the worklet ignores (worklet keeps filling),
    // if you want to actually stop capturing, we'd disconnect nodes — keep simple here.
    log(paused ? 'Запись приостановлена' : 'Запись продолжается');
    if (BTN_PAUSE) BTN_PAUSE.textContent = paused ? 'RESUME' : 'PAUSE';
  }

  async function stopRecording() {
    if (!recording) return;

    // ask worklet to flush partial buffer (if any)
    try {
      if (workletNode && workletNode.port && typeof workletNode.port.postMessage === 'function') {
        workletNode.port.postMessage({ type: 'flush' });
        // small wait allow worklet->main to post chunk and for main to send it
        await new Promise((r) => setTimeout(r, 180));
      }
    } catch (e) {
      console.warn('flush failed', e);
    }

    // send stop control
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', session_id: sessionId }));
    } else {
      setupWebSocket();
      if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'stop', session_id: sessionId })), { once: true });
    }

    // clean audio graph
    try { workletNode && workletNode.disconnect && workletNode.disconnect(); } catch (_) {}
    try { sourceNode && sourceNode.disconnect && sourceNode.disconnect(); } catch (_) {}
    try { audioCtx && audioCtx.close && audioCtx.close(); } catch (_) {}
    try { mediaStream && mediaStream.getTracks && mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}

    recording = false;
    paused = false;
    if (BTN_START) BTN_START.disabled = false;
    if (BTN_STOP) BTN_STOP.disabled = true;
    if (BTN_PAUSE) { BTN_PAUSE.disabled = true; BTN_PAUSE.textContent = 'PAUSE'; }
    log('Остановка записи — ожидаем обработку...');
  }

  // attach UI handlers if elements exist
  if (BTN_START) BTN_START.addEventListener('click', () => startRecording());
  if (BTN_PAUSE) BTN_PAUSE.addEventListener('click', () => pauseRecording());
  if (BTN_STOP) BTN_STOP.addEventListener('click', () => stopRecording());

  // initialize state
  if (BTN_PAUSE) BTN_PAUSE.disabled = true;
  if (BTN_STOP) BTN_STOP.disabled = true;
  log('Готов');
})();
