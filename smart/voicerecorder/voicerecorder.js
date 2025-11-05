// ---------- mic indicator dynamic import + init (no HTML changes required) ----------
(async function initMicIndicator() {
  try {
    const root = document.getElementById('vc-level');
    if (!root) return; // нет контейнера — ничего не делаем
    if (window._SV_MIC_INDICATOR) return; // уже инициализировано

    // динамический import — работает с <script defer src="voicerecorder.js"></script>
    const mod = await import('./mic-indicator/mic-indicator.js');
    // поддерживаем разные формы экспорта: default, named, or module itself
    const MicIndicator = mod && (mod.default || mod.MicIndicator || mod);
    if (typeof MicIndicator === 'function') {
      try {
        window._SV_MIC_INDICATOR = new MicIndicator(root);
        // По умолчанию индикатор должен быть неактивен (initial state)
        if (typeof window._SV_MIC_INDICATOR.setInactive === 'function') {
          window._SV_MIC_INDICATOR.setInactive();
        } else if (typeof window._SV_MIC_INDICATOR.setSimLevel === 'function') {
          window._SV_MIC_INDICATOR.setSimLevel(0);
        }
        console.debug('MicIndicator initialized');
      } catch (e) {
        console.warn('Failed to instantiate MicIndicator', e);
      }
    } else {
      console.warn('MicIndicator module loaded but export not found', mod);
    }
  } catch (e) {
    // не фейлим приложение если индикатор не загрузился
    console.warn('MicIndicator dynamic import failed', e);
  }
})();

// ---------- Existing voicerecorder logic (preserved, with MicIndicator usage points) ----------
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
  const WAVEFORM_CONTAINER = ROOT.querySelector('.vc-waveform');

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

  // Ensure unique session ID
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
          log('Ожидайте, идёт обработка...');
        } else if (data.type === 'error') {
          log('Ошибка сервера: ' + (data.message || ''));
        }
      } catch (e) {
        // ignore non-json
      }
    };
  }

  /* -------------------- Waveform indicator (как был) -------------------- */
  const Waveform = (function () {
    const container = WAVEFORM_CONTAINER;
    if (!container) return null;
    let bars = [];
    let raf = null;
    let targetLevels = [];
    let displayLevels = [];

    function build() {
      container.innerHTML = '';
      const cw = Math.max(40, container.clientWidth);
      const approxPitch = Math.max(6, Math.round(cw < 420 ? 6 : 8));
      const count = Math.max(10, Math.floor(cw / approxPitch));
      const center = Math.floor(count / 2);
      bars = [];
      targetLevels = new Array(count).fill(0);
      displayLevels = new Array(count).fill(0);

      for (let i = 0; i < count; i++) {
        const span = document.createElement('span');
        span.className = 'bar';
        if (Math.abs(i - center) < 2) span.classList.add('center');
        span.style.height = '14px';
        container.appendChild(span);
        bars.push(span);
      }
    }

    function pushLevel(rms) {
      if (!bars.length) return;
      const v = Math.min(1, rms * 6);
      const center = Math.floor(bars.length / 2);
      for (let i = 0; i < bars.length; i++) {
        const distance = Math.abs(i - center);
        const influence = Math.max(0, 1 - (distance / (bars.length * 0.5)));
        const val = v * (0.3 + 0.7 * influence);
        targetLevels[i] = Math.max(targetLevels[i] * 0.85, val);
      }
    }

    function animate() {
      for (let i = 0; i < bars.length; i++) {
        displayLevels[i] = displayLevels[i] * 0.7 + targetLevels[i] * 0.3;
        targetLevels[i] *= 0.92;
        const ch = container.clientHeight || 40;
        const minH = Math.floor(ch * 0.18);
        const maxH = Math.floor(ch * 0.85);
        const h = Math.round(minH + (maxH - minH) * Math.min(1, displayLevels[i]));
        bars[i].style.height = h + 'px';
      }
      raf = requestAnimationFrame(animate);
    }

    function start() {
      if (!bars.length) build();
      if (!raf) { raf = requestAnimationFrame(animate); }
    }
    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }
    function resize() {
      stop(); build(); start();
    }
    return { build, start, stop, pushLevel, resize };
  })();

  if (Waveform) {
    window.addEventListener('resize', () => { Waveform.resize(); }, { passive: true });
    window.addEventListener('orientationchange', () => { setTimeout(()=>Waveform.resize(), 120); }, { passive: true });
    Waveform.start();
  }

  /* -------------------- Recorder logic + MicIndicator integration -------------------- */
  async function startRecording() {
    ensureSession();
    setupWebSocket();

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const actualRate = audioCtx.sampleRate;
      const chunkSamples = Math.round(actualRate * CHUNK_SECONDS);

      // Get user media
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // --- CONNECT MIC INDICATOR HERE ---
      // Подключаем индикатор
      if (window._SV_MIC_INDICATOR && typeof window._SV_MIC_INDICATOR.connectStream === 'function') {
        try {
          window._SV_MIC_INDICATOR.connectStream(mediaStream);  // Интеграция с индикатором
        } catch (e) {
          console.warn('MicIndicator.connectStream failed', e);
        }
      }

      sourceNode = audioCtx.createMediaStreamSource(mediaStream);

      await audioCtx.audioWorklet.addModule('/voicerecorder/audioworklet-processor.js');
      workletNode = new AudioWorkletNode(audioCtx, 'chunker-processor');
      workletNode.port.postMessage({ type: 'config', chunk_samples: chunkSamples, sample_rate: actualRate, channels: 1 });

      workletNode.port.onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.type === 'level') {
          // Update waveform
          if (Waveform && typeof Waveform.pushLevel === 'function') Waveform.pushLevel(d.rms);

          // Update RMS to mic-indicator (if available)
          if (window._SV_MIC_INDICATOR) {
            try {
              if (typeof window._SV_MIC_INDICATOR.setLevel === 'function') {
                window._SV_MIC_INDICATOR.setLevel(d.rms);
              } else if (typeof window._SV_MIC_INDICATOR.setSimLevel === 'function') {
                window._SV_MIC_INDICATOR.setSimLevel(d.rms);
              } else if (typeof window._SV_MIC_INDICATOR.pushLevel === 'function') {
                window._SV_MIC_INDICATOR.pushLevel(d.rms);
              }
            } catch (err) {
              console.debug('MicIndicator level forward error', err);
            }
          }
        }
      };

      sourceNode.connect(workletNode);

      // Inform server start with measured rate
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
      try {
        if (window._SV_MIC_INDICATOR && typeof window._SV_MIC_INDICATOR.setInactive === 'function') {
          window._SV_MIC_INDICATOR.setInactive();
        } else if (window._SV_MIC_INDICATOR && typeof window._SV_MIC_INDICATOR.setSimLevel === 'function') {
          window._SV_MIC_INDICATOR.setSimLevel(0);
        }
      } catch(e) {}
    }
  }

  // Pause recording
  function pauseRecording() {
    if (!recording) return;
    paused = !paused;
    log(paused ? 'Запись приостановлена' : 'Запись продолжается');
    if (BTN_PAUSE) BTN_PAUSE.textContent = paused ? 'RESUME' : 'PAUSE';
  }

  // Stop recording
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

    // --- DISCONNECT MIC INDICATOR ---
    if (window._SV_MIC_INDICATOR) {
      try {
        if (typeof window._SV_MIC_INDICATOR.disconnect === 'function') {
          window._SV_MIC_INDICATOR.disconnect();
        } else if (typeof window._SV_MIC_INDICATOR.setSimLevel === 'function') {
          window._SV_MIC_INDICATOR.setSimLevel(0);
        } else if (typeof window._SV_MIC_INDICATOR.setInactive === 'function') {
          window._SV_MIC_INDICATOR.setInactive();
        }
      } catch (err) {
        console.debug('MicIndicator disconnect error', err);
      }
    }

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

  // Attach UI handlers
  if (BTN_START) BTN_START.addEventListener('click', () => startRecording());
  if (BTN_PAUSE) BTN_PAUSE.addEventListener('click', () => pauseRecording());
  if (BTN_STOP) BTN_STOP.addEventListener('click', () => stopRecording());

  // Init state
  if (BTN_PAUSE) BTN_PAUSE.disabled = true;
  if (BTN_STOP) BTN_STOP.disabled = true;
  log('Готов');
})();
