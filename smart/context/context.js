// context.js — SMART VISION context module
// Safe, defensive module: initializes audio recorder (AudioWorklet if available),
// handles start/stop/merge commands and exposes a minimal public API.
//
// Path assumptions:
// - recorder worklet is available at /context/recorder-worklet.js
// - If you use different paths, change WORKLET_URL constant below.

const WORKLET_URL = '/context/recorder-worklet.js';
const WORKLET_NAME = 'recorder-worklet';

(function globalInit(){
  if (window.__SMART_CONTEXT_INIT) return;
  window.__SMART_CONTEXT_INIT = true;

  // Public-ish objects (exposed for debugging)
  window.CURRENT_CONTEXT_OPTIONS = window.CURRENT_CONTEXT_OPTIONS || {};
  window.SMART_CONTEXT = window.SMART_CONTEXT || {};
  const SMART = window.SMART_CONTEXT;

  // Config defaults
  const CONFIG = {
    USE_WEBSOCKET: false,            // enable if you implement WS server
    WORKLET_URL: WORKLET_URL,
    WORKLET_NAME: WORKLET_NAME,
    AUTO_MERGE_ON_STOP: false,       // set true to call mergeSession() on stop
    RECORD_CHUNK_MS: 250,            // informational
  };

  // Logging helper
  function log(...args){
    console.log('SMART CONTEXT:', ...args);
  }
  SMART.log = log;

  // State
  let audioCtx = null;
  let workletNode = null;
  let localStream = null;
  let bufferQueue = []; // array of Float32Array chunks
  let isRecording = false;
  let ws = null;

  // Utility: safe element getter
  function q(id){ return document.getElementById(id) || document.querySelector(id); }

  // Initialize UI hooks (if elements exist)
  function initUI(){
    const startBtn = q('#start-rec') || q('[data-action="start-rec"]');
    const stopBtn = q('#stop-rec') || q('[data-action="stop-rec"]');
    const mergeBtn = q('#merge-now') || q('[data-action="merge-now"]');

    if (startBtn) startBtn.addEventListener('click', onStartClick);
    if (stopBtn) stopBtn.addEventListener('click', onStopClick);
    if (mergeBtn) mergeBtn.addEventListener('click', onMergeClick);

    log('UI handlers attached (start/stop/merge) if elements present');
  }

  // Open WebSocket (stub — only opens if CONFIG.USE_WEBSOCKET true and WS URL set on window)
  function openWS(){
    if (!CONFIG.USE_WEBSOCKET) return;
    try {
      const url = window.SMART_CONTEXT && window.SMART_CONTEXT.WS_URL;
      if (!url) {
        log('WS requested but no SMART_CONTEXT.WS_URL defined');
        return;
      }
      ws = new WebSocket(url);
      ws.onopen = () => log('WS open');
      ws.onclose = () => log('WS closed');
      ws.onerror = (e) => log('WS error', e);
      ws.onmessage = (m) => log('WS msg', m.data);
    } catch(e){
      log('openWS error', e);
    }
  }

  function closeWS(){
    if (ws) {
      try { ws.close(); } catch(e){ log('ws.close error', e); }
      ws = null;
    }
  }

  // Merge session (placeholder). Implement POST to your backend if needed.
  async function mergeSession(){
    log('mergeSession called — assembling audio parts:', bufferQueue.length);
    if (bufferQueue.length === 0) {
      log('mergeSession: nothing to merge');
      return null;
    }

    // Convert queue of Float32Array chunks into a single Float32Array
    const totalLen = bufferQueue.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of bufferQueue){
      out.set(chunk, offset);
      offset += chunk.length;
    }

    // Create WAV Blob (mono, 44.1 kHz) — minimal implementation
    function floatTo16BitPCM(float32Array) {
      const buffer = new ArrayBuffer(float32Array.length * 2);
      const view = new DataView(buffer);
      let offset = 0;
      for (let i = 0; i < float32Array.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      return view;
    }

    function encodeWAV(samples, sampleRate = (audioCtx ? audioCtx.sampleRate : 44100)) {
      const bytesPerSample = 2;
      const blockAlign = bytesPerSample * 1;
      const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
      const view = new DataView(buffer);

      // RIFF identifier
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + samples.length * bytesPerSample, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true); // fmt chunk size
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, 1, true); // channels
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bytesPerSample * 8, true);
      writeString(view, 36, 'data');
      view.setUint32(40, samples.length * bytesPerSample, true);

      // PCM samples
      const pcmView = floatTo16BitPCM(samples);
      for (let i = 0; i < pcmView.byteLength; i++) {
        view.setUint8(44 + i, pcmView.getUint8(i));
      }
      return new Blob([view], { type: 'audio/wav' });
    }

    function writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    const wav = encodeWAV(out);
    log('mergeSession: created wav blob, size=', wav.size);

    // Keep buffer queue until explicitly cleared
    // You can send wav to server:
    // await fetch('/context/merge', { method: 'POST', body: wav });

    return wav;
  }

  // Recorder initialization
  async function initRecorder(){
    if (isRecording) return;
    bufferQueue = [];

    // Try AudioWorklet
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // load worklet
      if (audioCtx.audioWorklet) {
        await audioCtx.audioWorklet.addModule(CONFIG.WORKLET_URL);
        workletNode = new AudioWorkletNode(audioCtx, CONFIG.WORKLET_NAME);
        workletNode.port.onmessage = (ev) => {
          // expected: Float32Array (or plain array)
          const data = ev.data;
          // normalize incoming typed arrays
          if (data instanceof Float32Array) {
            bufferQueue.push(new Float32Array(data));
          } else if (Array.isArray(data) || data.buffer instanceof ArrayBuffer) {
            try {
              bufferQueue.push(new Float32Array(data));
            } catch(e){
              // ignore
            }
          }
          // optionally forward to WS:
          if (ws && ws.readyState === WebSocket.OPEN) {
            // careful: binary send might be desired; here we send raw float32 as ArrayBuffer
            try { ws.send((data instanceof Float32Array) ? data.buffer : new Float32Array(data).buffer); } catch(e) {}
          }
        };
        log('AudioWorklet loaded and node created');
      } else {
        log('AudioWorklet not supported in this browser — will fallback to MediaRecorder');
        workletNode = null;
      }
    } catch(err) {
      log('initRecorder: worklet load error', err);
      workletNode = null;
    }

    // Acquire microphone
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (audioCtx && workletNode) {
        const src = audioCtx.createMediaStreamSource(localStream);
        src.connect(workletNode);
        workletNode.connect(audioCtx.destination); // keep audio graph connected for processing
      } else {
        // fallback: nothing connected — we'll rely on MediaRecorder in that case
      }
    } catch(e){
      log('getUserMedia error', e);
      throw e;
    }
  }

  async function startRecording(){
    try {
      if (isRecording) return;
      await initRecorder();
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();

      // If worklet exists we expect it to post frames
      if (workletNode && localStream) {
        isRecording = true;
        // send a start message to worklet (if implemented)
        try { workletNode.port.postMessage({ cmd: 'start' }); } catch(e){ }
        log('Recording started (worklet mode)');
      } else {
        // MEDIARECORDER fallback
        if (!localStream) await initRecorder();
        if (localStream) {
          const mediaRecorder = new MediaRecorder(localStream);
          const chunks = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size) chunks.push(e.data);
          };
          mediaRecorder.onstop = async () => {
            // decode & convert blob to Float32Array using offline audio context
            const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
            const arrayBuf = await blob.arrayBuffer();
            const decoded = await (audioCtx ? audioCtx.decodeAudioData(arrayBuf) : (new Promise(res => res(null))));
            if (decoded && decoded.getChannelData) {
              bufferQueue.push(new Float32Array(decoded.getChannelData(0)));
            }
            log('MediaRecorder stopped, chunks pushed');
          };
          mediaRecorder.start();
          SMART._mediaRecorder = mediaRecorder;
          isRecording = true;
          log('Recording started (MediaRecorder fallback)');
        } else {
          throw new Error('No audio input available');
        }
      }
    } catch(e){
      log('startRecording error', e);
      throw e;
    }
  }

  async function stopRecording(){
    try {
      if (!isRecording) {
        log('stopRecording: not recording');
        return;
      }
      isRecording = false;
      if (workletNode) {
        try { workletNode.port.postMessage({ cmd: 'stop' }); } catch(e) {}
      }
      // stop MediaRecorder fallback
      if (SMART._mediaRecorder && SMART._mediaRecorder.state !== 'inactive') {
        SMART._mediaRecorder.stop();
      }
      // stop tracks
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      closeWS();
      log('Recording stopped');

      if (CONFIG.AUTO_MERGE_ON_STOP) {
        await mergeSession();
      }
    } catch(e){
      log('stopRecording error', e);
    }
  }

  // UI handlers
  async function onStartClick(){
    try {
      // try to read options getter if provided by embedding page
      try {
        if (typeof window.getContextOptions === 'function') {
          const opts = window.getContextOptions();
          if (opts && typeof opts === 'object') window.CURRENT_CONTEXT_OPTIONS = opts;
        }
      } catch(e){}
      openWS();
      await startRecording();
    } catch(e){
      log('onStartClick error', e);
      alert('Не удалось запустить запись: ' + (e.message || e));
    }
  }

  async function onStopClick(){
    await stopRecording();
  }

  async function onMergeClick(){
    try {
      const wav = await mergeSession();
      if (wav) {
        log('merge complete. WAV size:', wav.size);
        // optional: download for quick check
        const url = URL.createObjectURL(wav);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'smart-merge.wav';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch(e){
      log('onMergeClick error', e);
    }
  }

  // safe exports
  SMART.startRecording = startRecording;
  SMART.stopRecording = stopRecording;
  SMART.mergeSession = mergeSession;
  SMART.initUI = initUI;
  SMART.initRecorder = initRecorder;
  SMART.CONFIG = CONFIG;
  SMART.bufferQueue = bufferQueue;

  // Auto-init UI when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  log('SMART CONTEXT: ready');
})();
