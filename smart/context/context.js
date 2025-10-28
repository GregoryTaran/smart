// /context/context.js
// Minimal SMART CONTEXT module — defensive, uses MediaRecorder fallback.
// Drop into /context/ to serve at /context/context.js (and /context/index.js imports it).

(function(){
  if (window.__SMART_CONTEXT_INIT) return;
  window.__SMART_CONTEXT_INIT = true;

  const SMART = window.SMART_CONTEXT = window.SMART_CONTEXT || {};
  SMART.CONFIG = SMART.CONFIG || { AUTO_DOWNLOAD_MERGE: true };

  function log(...args){ console.log('SMART CONTEXT:', ...args); }
  SMART.log = log;

  let mediaRecorder = null;
  let chunks = [];
  let streamRef = null;
  let recording = false;

  async function startRecording(){
    if (recording) { log('already recording'); return; }
    try {
      streamRef = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(err){
      log('getUserMedia failed', err);
      throw err;
    }

    try {
      mediaRecorder = new MediaRecorder(streamRef);
    } catch(err){
      log('MediaRecorder not available', err);
      streamRef.getTracks().forEach(t => t.stop());
      streamRef = null;
      throw err;
    }

    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      log('MediaRecorder onstop, chunks:', chunks.length);
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      if (SMART.CONFIG.AUTO_DOWNLOAD_MERGE) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'smart-record.webm';
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      }
    };

    mediaRecorder.start();
    recording = true;
    log('Recording started (MediaRecorder)');
  }

  async function stopRecording(){
    if (!recording) { log('not recording'); return; }
    try {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      recording = false;
      if (streamRef) {
        streamRef.getTracks().forEach(t => t.stop());
        streamRef = null;
      }
      log('Recording stopped');
    } catch(e){
      log('stopRecording error', e);
    }
  }

  function initUI(){
    try {
      const start = document.getElementById('start-rec') || document.querySelector('[data-action="start-rec"]');
      const stop  = document.getElementById('stop-rec')  || document.querySelector('[data-action="stop-rec"]');
      const merge = document.getElementById('merge-now') || document.querySelector('[data-action="merge-now"]');

      if (start) start.addEventListener('click', () => startRecording().catch(e=>alert('start error:'+e)));
      if (stop)  stop.addEventListener('click', () => stopRecording());
      if (merge) merge.addEventListener('click', () => alert('Use stop -> downloaded blob (if any).'));

      log('UI handlers attached (if elements present)');
    } catch(e){
      log('initUI error', e);
    }
  }

  SMART.startRecording = startRecording;
  SMART.stopRecording  = stopRecording;
  SMART.initUI = initUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  log('SMART CONTEXT: ready (minimal)');
})();
