// voicerecorder.js — updated: old Waveform removed, replaced with MicIndicator
(() => {
  const ROOT = document.querySelector('#main[data-module="voicerecorder"]');
  if (!ROOT) return;

  // UI elements
  const BTN_START = ROOT.querySelector('#vc-btn-start');
  const BTN_PAUSE = ROOT.querySelector('#vc-btn-pause');
  const BTN_STOP  = ROOT.querySelector('#vc-btn-stop');
  const STATUS    = ROOT.querySelector('#vc-status');
  const AUDIO_EL  = ROOT.querySelector('#vc-audio');
  const DOWNLOAD  = ROOT.querySelector('#vc-download');
  const TRANSCRIPT= ROOT.querySelector('#vc-transcript');
  const LEVEL_CONTAINER = ROOT.querySelector('#vc-level'); // container for mic indicator

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
  const pending = [];
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
          log('Ожидайте, идёт обработка.');
        } else if (data.type === 'error') {
          log('Ошибка сервера: ' + (data.message || ''));
        }
      } catch (e) {
        // ignore non-json
      }
    };
  }

  // --- MicIndicator init (lazy import) ---
  let micIndicator = null;
  (async function initMicIndicator(){
    if (!LEVEL_CONTAINER) return;
    try {
      const mod = await import('./mic-indicator/mic-indicator.js');
      const MicIndicator = mod.default;
      micIndicator = new MicIndicator(LEVEL_CONTAINER, {
        stepMs: 100,
        sensitivity: 0.9,
        barWidthMm: 0.85,
        gapPx: 2
      });
      // initially idle (shows baseline). No further actions needed.
    } catch (e) {
      console.warn('mic-indicator failed to load', e);
    }
  })();

  /* -------------------- Recorder logic -------------------- */
  async function startRecording() {
    ensureSession();
    setupWebSocket();

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const actualRate = audioCtx.sampleRate;
      const chunkSamples = Math.round(actualRate * CHUNK_SECONDS);

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);

      await audioCtx.audioWorklet.addModule('/voicerecorder/audioworklet-processor.js');
      workletNode = new AudioWorkletNode(audioCtx, 'chunker-processor');
      workletNode.port.postMessage({ type: 'config', chunk_samples: chunkSamples, sample_rate: actualRate, channels: 1 });

      workletNode.port.onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.type === 'level') {
          // feed our MicIndicator with mapped RMS
          // original mapping used in old Waveform: v = Math.min(1, rms * 6)
          try {
            if (micIndicator && typeof micIndicator.setSimLevel === 'function') {
              const v = Math.min(1, d.rms * 6);
              micIndicator.setSimLevel(v);
            }
          } catch (err) { /* ignore */ }
          // (old Waveform removed)
        } else if (d.type === 'chunk' && d.buffer) {
          const floatBuf = new Float32Array(d.buffer);
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

      // connect worklet silently
      try {
        const silent = audioCtx.createGain(); silent.gain.value = 0;
        workletNode.connect(silent);
        silent.connect(audioCtx.destination);
      } catch (e) {}

      sourceNode.connect(workletNode);

      // inform server start with measured rate
      const startMsg = { type: 'start', session_id: sessionId, sample_rate: actualRate, channels: 1, chunk_samples: chunkSamples };
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(startMsg));
      else if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify(startMsg)), { once: true });

      recording = true;
      paused = false;
      if (BTN_START) BTN_START.disabled = true;
      if (BTN_STOP) BTN_STOP.disabled = false;
      if (BTN_PAUSE) BTN_PAUSE.disabled = false;
      log('Recording.');
    } catch (err) {
      console.error('startRecording error', err);
      log('Ошибка: не удалось начать запись');
    }
  }

  function pauseRecording() {
    if (!recording) return;
    paused = !paused;
    log(paused ? 'Запись приостановлена' : 'Запись продолжается');
    if (BTN_PAUSE) BTN_PAUSE.textContent = paused ? 'RESUME' : 'PAUSE';
    // Note: worklet keeps running; if you want to truly pause capture, disconnect nodes.
  }

  async function stopRecording() {
    if (!recording) return;

    try {
      if (workletNode && workletNode.port && typeof workletNode.port.postMessage === 'function') {
        workletNode.port.postMessage({ type: 'flush' });
        await new Promise((r) => setTimeout(r, 180));
      }
    } catch (e) {
      console.warn('flush failed', e);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', session_id: sessionId }));
    } else {
      setupWebSocket();
      if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'stop', session_id: sessionId })), { once: true });
    }

    try { workletNode && workletNode.disconnect && workletNode.disconnect(); } catch (_) {}
    try { sourceNode && sourceNode.disconnect && sourceNode.disconnect(); } catch (_) {}
    try { audioCtx && audioCtx.close && audioCtx.close(); } catch (_) {}
    try { mediaStream && mediaStream.getTracks && mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}

    // stop mic indicator visualization
    try { if (micIndicator && typeof micIndicator.disconnect === 'function') micIndicator.disconnect(); } catch (_) {}

    recording = false;
    paused = false;
    if (BTN_START) BTN_START.disabled = false;
    if (BTN_STOP) BTN_STOP.disabled = true;
    if (BTN_PAUSE) { BTN_PAUSE.disabled = true; BTN_PAUSE.textContent = 'PAUSE'; }
    log('Остановка записи — ожидаем обработку.');
  }

  // Attach UI handlers
  if (BTN_START) BTN_START.addEventListener('click', () => startRecording());
  if (BTN_PAUSE) BTN_PAUSE.addEventListener('click', () => pauseRecording());
  if (BTN_STOP) BTN_STOP.addEventListener('click', () => stopRecording());

  // Init state
  if (BTN_PAUSE) BTN_PAUSE.disabled = true;
  if (BTN_STOP) BTN_STOP.disabled = true;
  log('Готов');
})();
