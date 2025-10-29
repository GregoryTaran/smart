// voicerecorderclient.js
// WebSocket-based recorder client adapted to existing HTML (vr-start, vr-pause, vr-stop, vr-level, vr-audio, vr-transcript).
// - uses AudioWorklet ('/recorder-worklet.js') if available, falls back to ScriptProcessor
// - accumulates Float32 chunks, flushes via WebSocket as binary ArrayBuffer
// - updates existing UI controls (no floating widget injected)
// - Pause suspends/resumes AudioContext (keeps buffers)

(() => {
  // CONFIG
  const FLUSH_SAMPLES_THRESHOLD = 4096 * 4;
  const FLUSH_INTERVAL_MS = 200;
  const CHANNELS = 1;
  const WORKLET_PATH = '/recorder-worklet.js';
  const WS_PATHS = ['/ws/voicerecorder', '/ws'];
  const RECONNECT_DELAY_MS = 1500;
  const CLIENT_STORAGE_KEY = 'smart_client_id_v1';
  const DEFAULT_SR = 48000;

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

  // UI elements (use existing if present)
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
  let pendingBuffers = [];
  let pendingSamples = 0;
  let seq = 0;
  let flushInterval = null;

  // ws
  let ws = null;
  let wsConnected = false;
  let wsConnecting = false;
  let wsPathIndex = 0;

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
      ws.send(JSON.stringify({ type:'meta', clientId: CLIENT_ID, sampleRate: SAMPLE_RATE, channels: CHANNELS }));
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const j = JSON.parse(ev.data);
          console.log('[vr] ws msg', j);
          if (j.type === 'finish' && j.filename) {
            // server finished and created file
            const audioEl = elAudio();
            if (audioEl) audioEl.src = `/api/voicerecorder/file/${encodeURIComponent(j.filename)}`;
            if (elTranscript() && j.transcript) elTranscript().textContent = j.transcript;
          }
        } catch (e){}
      } else {
        // ignore binary acks for now
      }
    };

    ws.onclose = () => {
      wsConnected = false; ws = null; wsConnecting = false;
      setStateText('ws disconnected');
      console.log('[vr] ws closed');
      wsPathIndex = (wsPathIndex + 1) % WS_PATHS.length;
      setTimeout(connectWS, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.warn('[vr] ws error', err);
    };
  }

  // ---------------- Audio / Worklet ----------------
  async function initAudio(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    SAMPLE_RATE = audioCtx.sampleRate || SAMPLE_RATE;

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
        const node = new AudioWorkletNode(audioCtx, 'recorder.processor', { numberOfInputs:1, numberOfOutputs:0, channelCount: CHANNELS });
        node.port.onmessage = onWorkletMessage;
        recorderNode = node;
        source.connect(recorderNode);
        workletOk = true;
        console.log('[vr] using AudioWorklet');
      }
    } catch (e) { console.warn('[vr] audioWorklet failed', e); }

    if (!workletOk) {
      // fallback
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
      recorderNode.connect(audioCtx.destination);
      console.log('[vr] using ScriptProcessor fallback');
    }
  }

  function onWorkletMessage(e){
    const obj = e.data;
    if (!obj) return;
    if (obj.rms !== undefined) setLevel(Math.min(1, obj.rms * 1.4));
    if (obj.buffer) {
      const f32 = new Float32Array(obj.buffer);
      handleAudioChunk(f32);
    }
  }

  // ---------------- Buffer accumulate + send ----------------
  function handleAudioChunk(float32arr){
    pendingBuffers.push(float32arr);
    pendingSamples += float32arr.length;
    // local RMS
    let s=0; for (let i=0;i<float32arr.length;i++) s+=float32arr[i]*float32arr[i];
    const rms = Math.sqrt(s/float32arr.length) || 0;
    setLevel(Math.min(1, rms * 1.4));
    if (pendingSamples >= FLUSH_SAMPLES_THRESHOLD) flushBuffers();
  }

  function concatBuffers(arrays, total){
    const out = new Float32Array(total);
    let off = 0;
    for (let i=0;i<arrays.length;i++){ out.set(arrays[i], off); off += arrays[i].length; }
    return out;
  }

  function flushBuffers(){
    if (!wsConnected || !ws || pendingSamples === 0) return;
    seq++;
    const total = pendingSamples;
    const out = concatBuffers(pendingBuffers, total);
    pendingBuffers = []; pendingSamples = 0;
    try {
      ws.send(out.buffer);
      console.log('[vr] sent ws chunk bytes=', out.byteLength, 'seq=', seq);
    } catch (e) {
      console.warn('[vr] ws send failed', e);
      // restore for retry
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
    if (wsConnected && ws) {
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

    // cleanup
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

  // ---------------- Wire buttons on DOMContentLoaded ----------------
  document.addEventListener('DOMContentLoaded', () => {
    const s = btnStart(); const p = btnPause(); const t = btnStop();
    if (s) s.addEventListener('click', startRecording);
    if (p) p.addEventListener('click', pauseRecording);
    if (t) t.addEventListener('click', stopRecording);

    // if UI elements absent, fail gracefully: create minimal fallback controls in console
    if (!s || !p || !t || !elLevel() || !elAudio()) {
      console.warn('[vr] some UI elements missing - ensure vr-start, vr-pause, vr-stop, vr-level, vr-audio in HTML');
    }
  });

  // expose API & debug
  window.SmartVoiceRecorder = {
    start: startRecording,
    pause: pauseRecording,
    stop: stopRecording,
    isRecording: () => isRecording,
    clientId: CLIENT_ID,
    debug: { connectWS, flushBuffers: flushBuffers }
  };
})();
