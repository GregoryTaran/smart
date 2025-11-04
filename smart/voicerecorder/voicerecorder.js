// VoiceRecorder/voicerecorder.js
// ESM module: integrates recorder logic and MicIndicator visualizer.

(function(){
  const ROOT = document.querySelector('#voice-recorder');
  if (!ROOT) return;

  const BTN_START = document.getElementById('vc-start');
  const BTN_PAUSE = document.getElementById('vc-pause');
  const BTN_STOP  = document.getElementById('vc-stop');
  const STATUS    = document.getElementById('vc-status');
  const AUDIO_EL  = document.getElementById('vc-audio');
  const DOWNLOAD  = document.getElementById('vc-download');
  const TRANSCRIPT= document.getElementById('vc-transcript');
  const LEVEL_CONTAINER = document.getElementById('vc-level');

  let audioCtx = null;
  let mediaStream = null;
  let sourceNode = null;
  let workletNode = null;
  let recording = false;
  let paused = false;
  let seq = 0;
  let sessionId = null;

  // Simple WS config — adapt to your backend if used
  let ws = null;
  const pending = [];
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/voicerecorder`;

  function log(text){
    if (STATUS) STATUS.textContent = text;
  }

  function ensureSession(){
    sessionId = localStorage.getItem('sv_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
      localStorage.setItem('sv_session_id', sessionId);
    }
    return sessionId;
  }

  function setupWebSocket(){
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { log('WS connected'); flushPending(); };
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
            log('Идёт обработка...');
          } else if (data.type === 'error') {
            log('Ошибка сервера: ' + (data.message || ''));
          }
        } catch (e) { /* ignore non-json */ }
      };
    } catch (e) {
      console.warn('WS create failed', e);
    }
  }

  function flushPending(){
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (pending.length) {
      const item = pending.shift();
      try {
        ws.send(JSON.stringify(item.meta));
        ws.send(item.buffer);
      } catch (e) {
        console.warn('ws flush fail', e);
        pending.unshift(item);
        break;
      }
    }
  }

  // --- MicIndicator integration (lazy import) ---
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
      // expose for debug
      try { window.__micIndicator = micIndicator; console.log('mic-indicator ready (window.__micIndicator)'); } catch(e){}
    } catch (e) {
      console.warn('mic-indicator load failed', e);
    }
  })();

  /* ------------------ Recorder logic ------------------ */
  const CHUNK_SECONDS = 2;

  async function startRecording(){
    ensureSession();
    setupWebSocket();
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const sampleRate = audioCtx.sampleRate;
      const chunkSamples = Math.round(sampleRate * CHUNK_SECONDS);

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);

      // load worklet processor from same folder
      await audioCtx.audioWorklet.addModule('./audioworklet-processor.js');
      workletNode = new AudioWorkletNode(audioCtx, 'chunker-processor');
      workletNode.port.postMessage({ type: 'config', chunk_samples: chunkSamples, sample_rate: sampleRate, channels: 1 });

      workletNode.port.onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.type === 'level') {
          // map rms to 0..1 (mapping chosen earlier)
          try {
            if (micIndicator && typeof micIndicator.setSimLevel === 'function') {
              const v = Math.min(1, d.rms * 6);
              micIndicator.setSimLevel(v);
            }
          } catch (err) { /* ignore */ }
        } else if (d.type === 'chunk' && d.buffer) {
          const floatBuf = new Float32Array(d.buffer);
          const valid = Number(d.valid_samples) || floatBuf.length;
          const meta = {
            type: 'chunk_meta',
            seq: seq++,
            sample_rate: sampleRate,
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

      // connect worklet (mute to destination to avoid echo if not desired)
      try {
        const g = audioCtx.createGain(); g.gain.value = 0;
        workletNode.connect(g);
        g.connect(audioCtx.destination);
      } catch (e) { /* ignore */ }

      sourceNode.connect(workletNode);

      // inform server about start
      const startMsg = { type: 'start', session_id: sessionId, sample_rate: sampleRate, channels: 1, chunk_samples: chunkSamples };
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(startMsg));
      else if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify(startMsg)), { once: true });

      // connect the mediaStream to audio element for quick local monitoring
      if (AUDIO_EL) {
        try {
          AUDIO_EL.srcObject = mediaStream;
          await AUDIO_EL.play().catch(()=>{});
        } catch(e){}
      }

      recording = true;
      paused = false;
      BTN_START.disabled = true;
      BTN_STOP.disabled = false;
      BTN_PAUSE.disabled = false;
      log('Recording...');
    } catch (err) {
      console.error('startRecording error', err);
      log('Ошибка: не удалось начать запись');
      BTN_START.disabled = false;
    }
  }

  function pauseRecording(){
    if (!recording) return;
    paused = !paused;
    log(paused ? 'Приостановлено' : 'Продолжаем запись');
    BTN_PAUSE.textContent = paused ? 'RESUME' : 'PAУЗА';
    // Note: to actually pause audio flow you would disconnect nodes; for now this toggles state
  }

  async function stopRecording(){
    if (!recording) return;
    try {
      if (workletNode && workletNode.port) workletNode.port.postMessage({ type: 'flush' });
    } catch (e) { console.warn('flush failed', e); }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', session_id: sessionId }));
    } else {
      setupWebSocket();
      if (ws) ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'stop', session_id: sessionId })), { once: true });
    }

    try { workletNode && workletNode.disconnect && workletNode.disconnect(); } catch (_) {}
    try { sourceNode && sourceNode.disconnect && sourceNode.disconnect(); } catch (_) {}
    try { if (audioCtx && audioCtx.close) await audioCtx.close(); } catch (_) {}
    try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}

    // stop visualizer
    try { if (micIndicator && typeof micIndicator.disconnect === 'function') micIndicator.disconnect(); } catch(_) {}

    recording = false;
    paused = false;
    BTN_START.disabled = false;
    BTN_STOP.disabled = true;
    BTN_PAUSE.disabled = true;
    log('Остановка. Ожидайте обработку.');
  }

  // UI events
  BTN_START.addEventListener('click', () => startRecording());
  BTN_PAUSE.addEventListener('click', () => pauseRecording());
  BTN_STOP.addEventListener('click', () => stopRecording());

  // initial state
  BTN_PAUSE.disabled = true;
  BTN_STOP.disabled = true;
  log('Готов');

})();
