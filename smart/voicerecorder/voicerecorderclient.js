// voicerecorderclient-ws.js
// WebSocket-based recorder client with pretty level bar ("полосочка").
// - uses AudioWorklet ('/recorder-worklet.js') if available (recommended), falls back to ScriptProcessor
// - accumulates Float32 chunks, flushes via WebSocket as binary ArrayBuffer
// - shows level bar, recording timer and connection status
// - auto reconnects WebSocket, sends initial meta message

(() => {
  // ----- Config -----
  const FLUSH_SAMPLES_THRESHOLD = 4096 * 4; // how many samples to accumulate before sending
  const FLUSH_INTERVAL_MS = 200; // periodic flush
  const CHANNELS = 1;
  const CLIENT_STORAGE_KEY = 'smart_client_id_v1';
  const WORKLET_PATH = '/recorder-worklet.js';
  const WS_PATHS = ['/ws/voicerecorder', '/ws']; // will try in order
  const RECONNECT_DELAY_MS = 1500;

  // ----- Utils -----
  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getClientId() {
    if (window.SMART_CLIENT_ID) return window.SMART_CLIENT_ID;
    try {
      let id = localStorage.getItem(CLIENT_STORAGE_KEY);
      if (!id) {
        id = uuidv4();
        localStorage.setItem(CLIENT_STORAGE_KEY, id);
      }
      window.SMART_CLIENT_ID = id;
      return id;
    } catch (e) {
      if (!window.SMART_CLIENT_ID) window.SMART_CLIENT_ID = uuidv4();
      return window.SMART_CLIENT_ID;
    }
  }

  function wsUrlFor(path) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${path}`;
  }

  // ----- UI helpers: create minimal, pretty UI if not present -----
  function ensureUI() {
    // If vr-level exists, assume UI present
    if (document.getElementById('vr-level')) return;

    // create container
    const container = document.createElement('div');
    container.id = 'vr-container';
    container.style.cssText = 'position:fixed;right:20px;bottom:20px;width:320px;padding:12px;border-radius:10px;background:rgba(0,0,0,0.6);color:#fff;font-family:Inter,Arial,sans-serif;z-index:9999';

    const title = document.createElement('div');
    title.textContent = 'Smart Voice — Recorder';
    title.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:14px';
    container.appendChild(title);

    // level bar
    const levelWrap = document.createElement('div');
    levelWrap.style.cssText = 'height:12px;background:rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;margin-bottom:8px';
    const levelInner = document.createElement('div');
    levelInner.id = 'vr-level';
    levelInner.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#ff8a00,#ff3d81);transition:width 0.08s linear';
    levelWrap.appendChild(levelInner);
    container.appendChild(levelWrap);

    // small status row
    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:13px';
    const state = document.createElement('div');
    state.id = 'vr-state';
    state.textContent = 'stopped';
    state.style.cssText = 'opacity:0.9';
    statusRow.appendChild(state);

    const timer = document.createElement('div');
    timer.id = 'vr-timer';
    timer.textContent = '00:00';
    timer.style.cssText = 'font-variant-numeric: tabular-nums';
    statusRow.appendChild(timer);
    container.appendChild(statusRow);

    // controls
    const controls = document.createElement('div');
    controls.style.cssText = 'margin-top:10px;display:flex;gap:8px';
    const startBtn = document.createElement('button');
    startBtn.id = 'vr-start';
    startBtn.textContent = 'Start';
    startBtn.style.cssText = 'flex:1;padding:8px;border-radius:8px;border:none;background:#00b894;color:#fff;font-weight:600;cursor:pointer';
    const stopBtn = document.createElement('button');
    stopBtn.id = 'vr-stop';
    stopBtn.textContent = 'Stop';
    stopBtn.style.cssText = 'flex:1;padding:8px;border-radius:8px;border:none;background:#d63031;color:#fff;font-weight:600;cursor:pointer';
    controls.appendChild(startBtn);
    controls.appendChild(stopBtn);
    container.appendChild(controls);

    // connection indicator
    const conn = document.createElement('div');
    conn.id = 'vr-conn';
    conn.style.cssText = 'margin-top:10px;font-size:12px;opacity:0.8';
    conn.textContent = 'WS: disconnected';
    container.appendChild(conn);

    document.body.appendChild(container);

    // hook existing elements (if html already has them)
    startBtn.addEventListener('click', () => window.SmartVoiceRecorder.start());
    stopBtn.addEventListener('click', () => window.SmartVoiceRecorder.stop());
  }

  // ----- Core variables -----
  let audioCtx = null;
  let recorderNode = null;
  let micStream = null;
  let isRecording = false;
  let SAMPLE_RATE = 48000;
  const CLIENT_ID = getClientId();

  // buffer accumulation
  let pendingBuffers = [];
  let pendingSamples = 0;
  let seq = 0;
  let flushInterval = null;

  // ws
  let ws = null;
  let wsPathIndex = 0;
  let wsConnected = false;
  let wsConnecting = false;

  // UI animation smoothing
  let displayedLevel = 0;
  let rafHandle = null;

  // ----- UI helpers -----
  function setStateText(s) {
    const el = document.getElementById('vr-state');
    if (el) el.textContent = s;
  }
  function setConnText(s) {
    const el = document.getElementById('vr-conn');
    if (el) el.textContent = 'WS: ' + s;
  }
  function setTimerText(s) {
    const el = document.getElementById('vr-timer');
    if (el) el.textContent = s;
  }
  function setLevel(v) {
    // v in 0..1 - animate smoothly using requestAnimationFrame
    displayedLevel = Math.max(displayedLevel * 0.75, v); // quick smoothing
    const el = document.getElementById('vr-level');
    if (el) {
      const pct = Math.min(100, Math.round(displayedLevel * 100));
      el.style.width = pct + '%';
    }
  }

  function startLevelLoop() {
    if (rafHandle) return;
    function loop() {
      // gradually decay displayedLevel for idle
      displayedLevel *= 0.95;
      const el = document.getElementById('vr-level');
      if (el) {
        const pct = Math.min(100, Math.round(displayedLevel * 100));
        el.style.width = pct + '%';
      }
      rafHandle = requestAnimationFrame(loop);
    }
    rafHandle = requestAnimationFrame(loop);
  }
  function stopLevelLoop() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  // ----- WebSocket management -----
  function connectWS() {
    if (wsConnected || wsConnecting) return;
    wsConnecting = true;
    const tryPath = WS_PATHS[wsPathIndex] || WS_PATHS[0];
    const url = wsUrlFor(tryPath);
    console.log('[voicerecorder] trying ws', url);
    setConnText('connecting...');
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      wsConnected = true;
      wsConnecting = false;
      setConnText('connected');
      console.log('[voicerecorder] ws connected');
      // send initial meta message
      const meta = { type: 'meta', clientId: CLIENT_ID, sampleRate: SAMPLE_RATE, channels: CHANNELS };
      ws.send(JSON.stringify(meta));
    };

    ws.onmessage = (ev) => {
      // handle control messages (server acks, progress) — try to parse JSON first
      if (typeof ev.data === 'string') {
        try {
          const j = JSON.parse(ev.data);
          // optional: server messages {type:'ok',...}
          console.log('[voicerecorder] ws msg', j);
        } catch (e) {
          // not JSON (ignore)
        }
      } else {
        // binary — could be server ack; ignore
      }
    };

    ws.onclose = () => {
      wsConnected = false;
      ws = null;
      wsConnecting = false;
      setConnText('disconnected');
      console.log('[voicerecorder] ws closed');
      // try next path (if multiple) and reconnect after delay
      wsPathIndex = (wsPathIndex + 1) % WS_PATHS.length;
      setTimeout(() => connectWS(), RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.warn('[voicerecorder] ws error', err);
      // close will trigger reconnect
    };
  }

  // ----- Audio init & worklet -----
  async function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    SAMPLE_RATE = audioCtx.sampleRate || SAMPLE_RATE;

    // request mic
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      console.error('[voicerecorder] getUserMedia failed', err);
      throw err;
    }

    const source = audioCtx.createMediaStreamSource(micStream);

    // try worklet
    let workletOk = false;
    try {
      if (audioCtx.audioWorklet) {
        await audioCtx.audioWorklet.addModule(WORKLET_PATH);
        const node = new AudioWorkletNode(audioCtx, 'recorder.processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: CHANNELS
        });
        node.port.onmessage = onWorkletMessage;
        recorderNode = node;
        source.connect(recorderNode);
        workletOk = true;
        console.log('[voicerecorder] using AudioWorklet');
      }
    } catch (e) {
      console.warn('[voicerecorder] audioWorklet failed, fallback', e);
    }

    if (!workletOk) {
      // fallback: ScriptProcessorNode
      const bufferSize = 4096;
      const proc = audioCtx.createScriptProcessor(bufferSize, CHANNELS, CHANNELS);
      proc.onaudioprocess = (evt) => {
        const inBuf = evt.inputBuffer.getChannelData(0);
        const copy = new Float32Array(inBuf.length);
        copy.set(inBuf);
        handleAudioChunk(copy);
      };
      recorderNode = proc;
      source.connect(recorderNode);
      recorderNode.connect(audioCtx.destination); // sometimes required
      console.log('[voicerecorder] using ScriptProcessor fallback');
    }
  }

  function onWorkletMessage(e) {
    // e.data: { buffer: ArrayBuffer, rms: Number }
    const obj = e.data;
    if (!obj) return;
    if (obj.rms !== undefined) {
      // update UI level (rms in 0..1)
      setLevel(Math.min(1, obj.rms * 1.4)); // scale a bit
    }
    if (obj.buffer) {
      // received transferred ArrayBuffer
      const f32 = new Float32Array(obj.buffer);
      handleAudioChunk(f32);
    }
  }

  // ----- Buffer accumulation + flush (sending via WS) -----
  function handleAudioChunk(float32arr) {
    pendingBuffers.push(float32arr);
    pendingSamples += float32arr.length;
    // maybe update level using local RMS as well
    let s = 0;
    for (let i = 0; i < float32arr.length; i++) s += float32arr[i] * float32arr[i];
    const rms = Math.sqrt(s / float32arr.length) || 0;
    setLevel(Math.min(1, rms * 1.4));
    // auto flush threshold
    if (pendingSamples >= FLUSH_SAMPLES_THRESHOLD) {
      flushBuffers();
    }
  }

  function concatBuffers(arrays, total) {
    const out = new Float32Array(total);
    let offset = 0;
    for (let i = 0; i < arrays.length; i++) {
      out.set(arrays[i], offset);
      offset += arrays[i].length;
    }
    return out;
  }

  function flushBuffers() {
    if (!wsConnected || !ws || pendingSamples === 0) {
      // if ws not connected, still drop or keep? Keep buffers to send later (we keep)
      return;
    }
    seq++;
    const total = pendingSamples;
    const out = concatBuffers(pendingBuffers, total);
    // reset queue
    pendingBuffers = [];
    pendingSamples = 0;

    // Send binary raw Float32LE. Server should know sampleRate & channels from meta.
    try {
      ws.send(out.buffer); // sends ArrayBuffer
      console.log('[voicerecorder] sent ws chunk bytes=', out.byteLength, 'seq=', seq);
    } catch (e) {
      console.warn('[voicerecorder] ws send failed', e);
      // restore to buffer for retry
      pendingBuffers.unshift(out);
      pendingSamples = out.length;
    }
  }

  // periodic flush to avoid too-long buffering
  function startFlushTimer() {
    if (flushInterval) return;
    flushInterval = setInterval(() => {
      flushBuffers();
    }, FLUSH_INTERVAL_MS);
  }
  function stopFlushTimer() {
    if (!flushInterval) return;
    clearInterval(flushInterval);
    flushInterval = null;
  }

  // ----- Recording controls -----
  let startTime = 0;
  function startRecording() {
    if (isRecording) return;
    ensureUI();
    setStateText('starting...');
    connectWS();
    // wait for ws to connect (optimistic: start anyway)
    initAudio().then(() => {
      // start flush timer
      startFlushTimer();
      isRecording = true;
      startTime = Date.now();
      setStateText('recording');
      startLevelLoop();
      // update timer
      timerLoop();
      console.log('[voicerecorder] recording started client=', CLIENT_ID);
    }).catch((err) => {
      console.error('[voicerecorder] startRecording failed', err);
      setStateText('error');
    });
  }

  function stopRecording() {
    if (!isRecording) return;
    setStateText('stopping...');
    // flush buffers one last time
    flushBuffers();
    stopFlushTimer();

    // send finish control message via ws (if ws connected), or fallback to HTTP finish
    const finishPayload = { type: 'finish', clientId: CLIENT_ID, filename: `${Date.now()}-${CLIENT_ID}.raw` };
    if (wsConnected && ws) {
      try {
        ws.send(JSON.stringify(finishPayload));
        console.log('[voicerecorder] sent finish via ws', finishPayload);
      } catch (e) {
        console.warn('[voicerecorder] ws finish send failed, falling back to HTTP', e);
        sendFinishHttp(finishPayload);
      }
    } else {
      sendFinishHttp(finishPayload);
    }

    // cleanup audio nodes
    try {
      if (recorderNode) {
        try { recorderNode.disconnect(); } catch (e) {}
        recorderNode = null;
      }
      if (micStream) {
        const tracks = micStream.getTracks();
        for (const t of tracks) t.stop();
        micStream = null;
      }
      // Note: do not close audioCtx to allow quick restart
    } catch (e) {
      console.warn('[voicerecorder] stop cleanup error', e);
    }

    isRecording = false;
    setStateText('stopped');
    stopLevelLoop();
    console.log('[voicerecorder] recording stopped');
  }

  function sendFinishHttp(obj) {
    fetch('/api/voicerecorder/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: obj.clientId, filename: obj.filename })
    }).then(r => r.json()).then(j => {
      console.log('[voicerecorder] finish http result', j);
    }).catch(e => console.error('[voicerecorder] finish http error', e));
  }

  // update timer display
  let timerInterval = null;
  function timerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!isRecording) {
        setTimerText('00:00');
        clearInterval(timerInterval);
        timerInterval = null;
        return;
      }
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      setTimerText(`${mm}:${ss}`);
    }, 333);
  }

  // ----- Expose API -----
  window.SmartVoiceRecorder = {
    start: startRecording,
    stop: stopRecording,
    isRecording: () => isRecording,
    clientId: CLIENT_ID
  };

  // auto-inject UI and wire buttons
  document.addEventListener('DOMContentLoaded', () => {
    ensureUI();
    const startBtn = document.getElementById('vr-start');
    const stopBtn = document.getElementById('vr-stop');
    if (startBtn) startBtn.addEventListener('click', () => window.SmartVoiceRecorder.start());
    if (stopBtn) stopBtn.addEventListener('click', () => window.SmartVoiceRecorder.stop());
  });

  // expose debug function
  window._smart_vr_debug = {
    connectWS,
    flushBuffers,
    pendingSamples: () => pendingSamples
  };
})();
