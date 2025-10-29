
// VoiceRecorderClient.js (updated, stress-hardened, with auto-inject UI)
// Place this file alongside recorder-worklet.js and voicerecorderstyle.css
// Exposes window.SmartVoiceRecorder { start, pause, stop, clientId, debug }

(() => {
  // CONFIG
  const FLUSH_INTERVAL_MS = 2000;           // ~2 seconds
  const CHANNELS = 1;
  const RECONNECT_DELAY_MS = 1500;
  const CLIENT_STORAGE_KEY = 'smart_client_id_v1';
  const DEFAULT_SR = 48000;
  const PROCESSOR_NAME = 'recorder-processor'; // must match recorder-worklet.js registration
  const HEARTBEAT_MS = 20000;               // send ping JSON every 20s
  const MAX_PENDING_SECONDS = 10;           // max backlog to hold (seconds) before dropping

  // utils
  function uuidv4(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;const v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});}
  function getClientId(){
    if (window.SMART_CLIENT_ID) return window.SMART_CLIENT_ID;
    try {
      let id = localStorage.getItem(CLIENT_STORAGE_KEY);
      if (!id) { id = uuidv4(); localStorage.setItem(CLIENT_STORAGE_KEY, id); }
      window.SMART_CLIENT_ID = id;
      return id;
    } catch (e) { if (!window.SMART_CLIENT_ID) window.SMART_CLIENT_ID = uuidv4(); return window.SMART_CLIENT_ID; }
  }
  function wsUrlFor(path){ const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'; return `${proto}//${location.host}${path}`; }

  // determine script dir (so worklet + css are next to this file)
  function getScriptDir() {
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i];
        if (!s.src) continue;
        if (s.src.indexOf('VoiceRecorderClient.js') !== -1 || s.src.indexOf('voicerecorderclient.js') !== -1) {
          const url = new URL(s.src, location.href);
          const path = url.pathname;
          return url.origin + path.substring(0, path.lastIndexOf('/') + 1);
        }
      }
    } catch (e){}
    return location.origin + '/';
  }

  const SCRIPT_DIR = getScriptDir();
  const WORKLET_PATH = SCRIPT_DIR + 'recorder-worklet.js';
  const CSS_PATH = SCRIPT_DIR + 'voicerecorderstyle.css';

  // ensure CSS present (auto-inject if not)
  function ensureCssLoaded() {
    try {
      const exists = Array.from(document.styleSheets).some(ss => {
        try { return ss.href && ss.href.indexOf('voicerecorderstyle.css') !== -1; } catch(e){ return false; }
      });
      if (!exists) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS_PATH;
        document.head.appendChild(link);
        console.log('[vr] injected css', CSS_PATH);
      }
    } catch (e) { console.warn('[vr] css injection failed', e); }
  }

  // UI element getters
  const elLevel = () => document.getElementById('vr-level');
  const elState = () => document.getElementById('vr-state');
  const elTimer = () => document.getElementById('vr-timer');
  const elAudio = () => document.getElementById('vr-audio');
  const elTranscript = () => document.getElementById('vr-transcript');
  const btnStart = () => document.getElementById('vr-start');
  const btnPause = () => document.getElementById('vr-pause');
  const btnStop  = () => document.getElementById('vr-stop');

  // Core state
  let audioCtx = null;
  let recorderNode = null;
  let micStream = null;
  let isRecording = false;
  let isPaused = false;
  let SAMPLE_RATE = DEFAULT_SR;
  const CLIENT_ID = getClientId();

  // buffers
  let pendingBuffers = []; // array of Float32Array
  let pendingSamples = 0;
  let seq = 0;
  let flushInterval = null;

  // ws
  let ws = null;
  let wsConnected = false;
  let wsConnecting = false;
  let wsPathIndex = 0;
  const WS_PATHS = ['/ws/voicerecorder', '/ws/voicerecorder/'];

  // heartbeat
  let heartbeatTimer = null;

  // smoothing for level UI
  let displayedLevel = 0;
  let raf = null;

  // timer
  let startTime = 0;
  let timerInterval = null;

  // ---------------- UI helpers ----------------
  function setStateText(s){ const el=elState(); if(el) el.textContent=s; }
  function setTimerText(t){ const el=elTimer(); if(el) el.textContent=t; }
  function setLevel(v){
    displayedLevel = Math.max(displayedLevel * 0.75, v);
    const el = elLevel();
    if (el) el.style.width = Math.min(100, Math.round(displayedLevel * 100)) + '%';
  }
  function startLevelLoop(){
    if (raf) return;
    function loop(){ displayedLevel *= 0.95; const el=elLevel(); if(el) el.style.width = Math.min(100, Math.round(displayedLevel*100)) + '%'; raf = requestAnimationFrame(loop); }
    raf = requestAnimationFrame(loop);
  }
  function stopLevelLoop(){ if (raf) cancelAnimationFrame(raf); raf = null; }

  // ---------------- WebSocket ----------------
  function connectWS(){
    if (wsConnected || wsConnecting) return;
    wsConnecting = true;
    const tryPath = WS_PATHS[wsPathIndex] || WS_PATHS[0];
    const url = wsUrlFor(tryPath);
    console.log('[vr] trying ws', url);
    setStateText('connecting ws...');
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      wsConnected = true; wsConnecting = false;
      setStateText('recording (ws)');
      console.log('[vr] ws connected');
      // send meta immediately
      ws.send(JSON.stringify({ type:'meta', clientId: CLIENT_ID, sampleRate: SAMPLE_RATE, channels: CHANNELS }));
      console.log('[vr] ws meta sent', { clientId: CLIENT_ID, sampleRate: SAMPLE_RATE, channels: CHANNELS });
      startHeartbeat();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const j = JSON.parse(ev.data);
          console.log('[vr] ws msg', j);
          if (j.type === 'finish' && j.filename) {
            const audioEl = elAudio();
            if (audioEl) audioEl.src = `/api/voicerecorder/file/${encodeURIComponent(j.filename)}`;
            if (elTranscript() && j.transcript) elTranscript().textContent = j.transcript;
          } else if (j.type === 'pong') {
            // heartbeat ack
          } else if (j.type === 'meta_ack') {
            // ok
          }
        } catch (e){}
      } else {
        // binary responses (ignored for now)
      }
    };

    ws.onclose = () => {
      wsConnected = false; ws = null; wsConnecting = false;
      setStateText('ws disconnected');
      console.log('[vr] ws closed');
      stopHeartbeat();
      wsPathIndex = (wsPathIndex + 1) % WS_PATHS.length;
      setTimeout(connectWS, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.warn('[vr] ws error', err);
    };
  }

  function startHeartbeat(){
    stopHeartbeat();
    heartbeatTimer = setInterval(()=>{
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type:'ping', ts: Date.now() })); } catch(e){ console.warn('[vr] heartbeat send err', e); }
      }
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat(){ if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } }

  // ---------------- Audio / Worklet ----------------
  async function initAudio(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    SAMPLE_RATE = audioCtx.sampleRate || SAMPLE_RATE;
    const FLUSH_SAMPLES_THRESHOLD = Math.max(1024, Math.floor(SAMPLE_RATE * 2));
    const MAX_PENDING_SAMPLES = Math.floor(SAMPLE_RATE * MAX_PENDING_SECONDS);

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
    } catch (e) {
      console.error('[vr] getUserMedia failed', e);
      throw e;
    }

    const source = audioCtx.createMediaStreamSource(micStream);

    let workletOk = false;
    try {
      if (audioCtx.audioWorklet) {
        await audioCtx.audioWorklet.addModule(WORKLET_PATH);
        const node = new AudioWorkletNode(audioCtx, PROCESSOR_NAME, { numberOfInputs:1, numberOfOutputs:0, channelCount: CHANNELS });
        node.port.onmessage = (e) => onWorkletMessage(e, MAX_PENDING_SAMPLES);
        recorderNode = node;
        source.connect(recorderNode);
        workletOk = true;
        console.log('[vr] using AudioWorklet', WORKLET_PATH);
      }
    } catch (e) { console.warn('[vr] audioWorklet failed', e); }

    if (!workletOk) {
      // fallback ScriptProcessor
      const bufferSize = 4096;
      const proc = audioCtx.createScriptProcessor(bufferSize, CHANNELS, CHANNELS);
      proc.onaudioprocess = (evt) => {
        const inBuf = evt.inputBuffer.getChannelData(0);
        const copy = new Float32Array(inBuf.length);
        copy.set(inBuf);
        onWorkletMessage({ data: copy }, MAX_PENDING_SAMPLES);
      };
      recorderNode = proc;
      source.connect(recorderNode);
      recorderNode.connect(audioCtx.destination);
      console.log('[vr] using ScriptProcessor fallback');
    }
  }

  // Worklet messages may be either Float32Array or an object { buffer, rms }
  function onWorkletMessage(e, MAX_PENDING_SAMPLES) {
    const obj = e.data;
    if (!obj) return;
    try {
      if (obj instanceof Float32Array) {
        handleAudioChunk(obj, MAX_PENDING_SAMPLES);
      } else if (obj && obj.buffer) {
        const f32 = (obj.buffer instanceof ArrayBuffer) ? new Float32Array(obj.buffer) : new Float32Array(obj.buffer);
        if (obj.rms !== undefined) setLevel(Math.min(1, obj.rms * 1.4));
        handleAudioChunk(f32, MAX_PENDING_SAMPLES);
      } else if (obj instanceof ArrayBuffer) {
        handleAudioChunk(new Float32Array(obj), MAX_PENDING_SAMPLES);
      } else {
        if (ArrayBuffer.isView(obj)) {
          handleAudioChunk(new Float32Array(obj.buffer), MAX_PENDING_SAMPLES);
        }
      }
    } catch (err) {
      console.warn('[vr] worklet msg parse err', err);
    }
  }

  // ---------------- Buffer accumulate + send ----------------
  function handleAudioChunk(float32arr, MAX_PENDING_SAMPLES) {
    if (typeof MAX_PENDING_SAMPLES === 'number' && pendingSamples + float32arr.length > MAX_PENDING_SAMPLES) {
      let needed = (pendingSamples + float32arr.length) - MAX_PENDING_SAMPLES;
      console.warn('[vr] backlog too big, trimming oldest samples', { pendingSamples, needed });
      while (needed > 0 && pendingBuffers.length) {
        const removed = pendingBuffers.shift();
        pendingSamples -= removed.length;
        needed -= removed.length;
      }
      if (pendingSamples + float32arr.length > MAX_PENDING_SAMPLES) {
        console.warn('[vr] dropping incoming audio chunk to avoid OOM');
        return;
      }
    }

    const copy = new Float32Array(float32arr.length);
    copy.set(float32arr);
    pendingBuffers.push(copy);
    pendingSamples += copy.length;

    let s=0; for (let i=0;i<copy.length;i++) s+=copy[i]*copy[i];
    const rms = Math.sqrt(s/copy.length) || 0;
    setLevel(Math.min(1, rms * 1.4));
  }

  function concatBuffers(arrays, total){
    const out = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < arrays.length; i++) { out.set(arrays[i], off); off += arrays[i].length; }
    return out;
  }

  function flushBuffers(){
    if (pendingSamples === 0) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[vr] ws not open, deferring flush (pendingSamples=', pendingSamples,')');
      return;
    }
    seq++;
    const total = pendingSamples;
    const out = concatBuffers(pendingBuffers, total);
    pendingBuffers = []; pendingSamples = 0;
    try {
      ws.send(out.buffer);
      console.log('[vr] sent ws chunk bytes=', out.byteLength, 'seq=', seq);
    } catch (e) {
      console.warn('[vr] ws send failed', e);
      pendingBuffers.unshift(out);
      pendingSamples = out.length;
    }
  }

  function startFlushTimer(){ if (flushInterval) return; flushInterval = setInterval(flushBuffers, FLUSH_INTERVAL_MS); }
  function stopFlushTimer(){ if (!flushInterval) return; clearInterval(flushInterval); flushInterval = null; }

  // ---------------- Controls ----------------
  async function startRecording(){
    if (isRecording) return;
    setStateText('starting');
    ensureCssLoaded();
    connectWS();
    try {
      await initAudio();
    } catch (e) { setStateText('mic error'); return; }
    startFlushTimer();
    isRecording = true;
    isPaused = false;
    startTime = Date.now();
    setStateText(wsConnected ? 'recording (ws)' : 'recording');
    startLevelLoop();
    startTimer();
    console.log('[vr] recording started client=', CLIENT_ID);
  }

  function pauseRecording(){
    if (!isRecording) return;
    if (!audioCtx) return;
    if (!isPaused) {
      audioCtx.suspend && audioCtx.suspend();
      isPaused = true;
      setStateText('paused');
      console.log('[vr] paused');
    } else {
      audioCtx.resume && audioCtx.resume();
      isPaused = false;
      setStateText(wsConnected ? 'recording (ws)' : 'recording');
      console.log('[vr] resumed');
    }
  }

  function stopRecording(){
    if (!isRecording) return;
    setStateText('stopping');
    flushBuffers();
    stopFlushTimer();

    const finishPayload = { type:'finish', clientId: CLIENT_ID, filename: `${Date.now()}-${CLIENT_ID}.raw` };
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(finishPayload));
        console.log('[vr] sent finish via ws', finishPayload);
      } catch (e) {
        console.warn('[vr] ws finish failed, fallback http', e);
        sendFinishHttp(finishPayload);
      }
    } else {
      sendFinishHttp(finishPayload);
    }

    try {
      if (recorderNode) { try{recorderNode.disconnect();}catch(e){} recorderNode = null; }
      if (micStream) { micStream.getTracks().forEach(t=>t.stop()); micStream = null; }
    } catch (e) { console.warn('[vr] cleanup error', e); }

    isRecording = false;
    isPaused = false;
    setStateText('stopped');
    stopLevelLoop();
    stopTimer();
    console.log('[vr] recording stopped');
  }

  function sendFinishHttp(obj){
    fetch('/api/voicerecorder/finish', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ clientId: obj.clientId, filename: obj.filename })
    }).then(r=>r.json()).then(j=>{
      console.log('[vr] finish http result', j);
      if (j && j.wavConverted && j.wavUrl) {
        const audioEl = elAudio(); if (audioEl) audioEl.src = j.wavUrl;
        if (elTranscript() && j.transcript) elTranscript().textContent = j.transcript;
      } else if (j && j.filename) {
        const audioEl = elAudio(); if (audioEl) audioEl.src = `/api/voicerecorder/file/${encodeURIComponent(j.filename)}`;
      }
    }).catch(e=>console.error('[vr] finish http error', e));
  }

  // ---------------- Timer ----------------
  function startTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval = setInterval(()=>{
    if (!isRecording) { setTimerText('00:00'); clearInterval(timerInterval); timerInterval = null; return; }
    const sec = Math.floor((Date.now() - startTime)/1000);
    setTimerText(String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0'));
  }, 333); }
  function stopTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval = null; setTimerText('00:00'); }

  // --- START: DOMContentLoaded replacement — inject UI if missing ---
  document.addEventListener('DOMContentLoaded', () => {
    // try to keep user's existing elements if present
    const s = btnStart(); const p = btnPause(); const t = btnStop();
    const levelEl = elLevel(); const audioEl = elAudio(); const stateEl = elState();

    // If core elements missing — inject a compact, styled control block that matches voicerecorderstyle.css
    if (!s || !p || !t || !levelEl || !audioEl) {
      console.warn('[vr] some UI elements missing - injecting minimal recorder UI');

      // container where we try to append controls: prefer element with id="voicerecorder-root" if present, else body
      let root = document.getElementById('voicerecorder-root') || document.body;

      // create controls only if absent
      if (!document.getElementById('vr-controls-injected')) {
        const container = document.createElement('div');
        container.id = 'vr-controls-injected';
        container.style.margin = '12px 0';
        container.innerHTML = `
          <div id="controls" style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
            <button id="vr-start">Start</button>
            <button id="vr-pause">Pause</button>
            <button id="vr-stop">Stop</button>
            <div id="vr-state" style="margin-left:12px;font-size:14px;color:#444">idle</div>
            <div id="vr-timer" style="margin-left:10px;font-family:monospace;color:#666">00:00</div>
          </div>
          <div id="rec-indicator" style="height:14px;">
            <div id="rec-wave" style="position:relative;overflow:hidden;border-radius:6px;background:#eee;height:100%;">
              <div id="vr-level" style="height:100%;width:0%;background:linear-gradient(90deg,#06b,#39f);transition:width 120ms linear;"></div>
            </div>
          </div>
          <div id="playback" style="margin-top:10px">
            <audio id="vr-audio" controls></audio>
          </div>
          <div id="transcript" style="margin-top:8px"><pre id="vr-transcript"></pre></div>
        `;
        root.insertBefore(container, root.firstChild);
      }

      // rebind functions to newly injected elements
      if (btnStart() && !btnStart().hasListenerInjected) {
        btnStart().addEventListener('click', startRecording);
        btnStart().hasListenerInjected = true;
      }
      if (btnPause() && !btnPause().hasListenerInjected) {
        btnPause().addEventListener('click', pauseRecording);
        btnPause().hasListenerInjected = true;
      }
      if (btnStop() && !btnStop().hasListenerInjected) {
        btnStop().addEventListener('click', stopRecording);
        btnStop().hasListenerInjected = true;
      }

      setStateText('ready');
    } else {
      // existing elements present — attach listeners if not already attached
      if (s && !s._vrBound) { s.addEventListener('click', startRecording); s._vrBound = true; }
      if (p && !p._vrBound) { p.addEventListener('click', pauseRecording); p._vrBound = true; }
      if (t && !t._vrBound) { t.addEventListener('click', stopRecording); t._vrBound = true; }
    }

    const startBtn = btnStart();
    if (startBtn) startBtn.tabIndex = 0;
  });
  // --- END: DOMContentLoaded replacement ---

  // expose API & debug
  window.SmartVoiceRecorder = {
    start: startRecording,
    pause: pauseRecording,
    stop: stopRecording,
    isRecording: () => isRecording,
    clientId: CLIENT_ID,
    debug: { connectWS, flushBuffers, SCRIPT_DIR }
  };
})();
