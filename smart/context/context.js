// /context/context.js
// Minimal SMART CONTEXT with built-in renderer (window.contextRender).
// Creates mount UI with Start/Stop/Merge and uses MediaRecorder fallback.

(function(){
  if (window.__SMART_CONTEXT_INIT) return;
  window.__SMART_CONTEXT_INIT = true;

  const SMART = window.SMART_CONTEXT = window.SMART_CONTEXT || {};
  SMART.CONFIG = SMART.CONFIG || { AUTO_DOWNLOAD_ON_STOP: true };

  function log(...args){ console.log('SMART CONTEXT:', ...args); }
  SMART.log = log;

  // State
  let mediaRecorder = null;
  let chunks = [];
  let streamRef = null;
  let recording = false;
  SMART.lastBlob = null;

  // start recording (MediaRecorder fallback)
  async function startRecording(){
    if (recording) { log('startRecording: already recording'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('startRecording: getUserMedia not supported');
      throw new Error('getUserMedia not supported');
    }

    try {
      streamRef = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(err){
      log('startRecording: getUserMedia failed', err);
      throw err;
    }

    try {
      mediaRecorder = new MediaRecorder(streamRef);
    } catch(err) {
      log('startRecording: MediaRecorder init failed', err);
      // cleanup
      if (streamRef) { streamRef.getTracks().forEach(t=>t.stop()); streamRef = null; }
      throw err;
    }

    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      try {
        if (chunks.length === 0) {
          log('onstop: no chunks');
          SMART.lastBlob = null;
          return;
        }
        const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
        SMART.lastBlob = blob;
        log('onstop: created blob, size=', blob.size);
        if (SMART.CONFIG.AUTO_DOWNLOAD_ON_STOP) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'smart-record.webm';
          a.click();
          setTimeout(()=>URL.revokeObjectURL(url), 60000);
        }
      } catch(e) {
        log('onstop error', e);
      }
    };

    mediaRecorder.start();
    recording = true;
    log('Recording started (MediaRecorder)');
  }

  // stop recording
  async function stopRecording(){
    if (!recording) { log('stopRecording: not recording'); return; }
    try {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
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

  // merge / provide last blob (returns Blob or null)
  async function mergeSession(){
    if (SMART.lastBlob) return SMART.lastBlob;
    log('mergeSession: no last blob available');
    return null;
  }

  // Expose
  SMART.startRecording = startRecording;
  SMART.stopRecording = stopRecording;
  SMART.mergeSession = mergeSession;

  // Renderer inserted into window so index.js can find it
  window.contextRender = function(mountElement){
    try {
      if (!mountElement || !(mountElement instanceof Element)) {
        console.warn('contextRender: invalid mount element, aborting render.');
        return;
      }

      // Clear mount
      mountElement.innerHTML = '';

      const container = document.createElement('div');
      container.style.cssText = 'padding:12px;border:1px solid #ddd;border-radius:8px;max-width:420px;font-family:Inter,system-ui,Arial,sans-serif';
      
      const title = document.createElement('div');
      title.textContent = 'SMART Context (minimal)';
      title.style.cssText = 'font-weight:600;margin-bottom:8px;';
      container.appendChild(title);

      const status = document.createElement('div');
      status.textContent = 'idle';
      status.id = 'smart-context-status';
      status.style.cssText = 'margin-bottom:12px;color:#555;';
      container.appendChild(status);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;';

      const startBtn = document.createElement('button');
      startBtn.textContent = 'Start';
      startBtn.id = 'start-rec';
      startBtn.style.cssText = 'padding:8px 12px;border-radius:6px;border:1px solid #2b7;color:#fff;background:#2b7;';
      btnRow.appendChild(startBtn);

      const stopBtn = document.createElement('button');
      stopBtn.textContent = 'Stop';
      stopBtn.id = 'stop-rec';
      stopBtn.style.cssText = 'padding:8px 12px;border-radius:6px;border:1px solid #c33;color:#fff;background:#c33;';
      btnRow.appendChild(stopBtn);

      const mergeBtn = document.createElement('button');
      mergeBtn.textContent = 'Merge / Download';
      mergeBtn.id = 'merge-now';
      mergeBtn.style.cssText = 'padding:8px 12px;border-radius:6px;border:1px solid #666;background:#eee;';
      btnRow.appendChild(mergeBtn);

      container.appendChild(btnRow);

      // info line
      const info = document.createElement('div');
      info.style.cssText = 'margin-top:10px;font-size:12px;color:#777;';
      info.textContent = 'Uses MediaRecorder fallback. Allow microphone when prompted.';
      container.appendChild(info);

      mountElement.appendChild(container);

      // Hook events
      startBtn.addEventListener('click', async () => {
        try {
          status.textContent = 'starting...';
          await SMART.startRecording();
          status.textContent = 'recording';
        } catch(e){
          status.textContent = 'error starting';
          alert('Ошибка при старте: ' + (e && e.message ? e.message : e));
        }
      });

      stopBtn.addEventListener('click', async () => {
        try {
          status.textContent = 'stopping...';
          await SMART.stopRecording();
          status.textContent = 'idle';
        } catch(e){
          status.textContent = 'error stopping';
          alert('Ошибка при остановке: ' + (e && e.message ? e.message : e));
        }
      });

      mergeBtn.addEventListener('click', async () => {
        try {
          const b = await SMART.mergeSession();
          if (!b) { alert('Нет доступного аудиофайла. Сначала запишите и остановите.'); return; }
          const url = URL.createObjectURL(b);
          const a = document.createElement('a');
          a.href = url; a.download = 'smart-merge.webm';
          a.click();
          setTimeout(()=>URL.revokeObjectURL(url), 60000);
        } catch(e){
          alert('Ошибка merge: ' + (e && e.message ? e.message : e));
        }
      });

      // Also attach to SMART.initUI if other code expects these ids
      if (typeof SMART.initUI === 'function') {
        SMART.initUI(); // safe — it will attach handlers if needed
      }

      log('contextRender: mounted UI');
    } catch(e){
      log('contextRender error', e);
    }
  };

  // If DOM already has a special mount element, auto-render to it.
  // Useful for quick checks — element id: "smart-context-mount"
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    const autoMount = document.getElementById('smart-context-mount');
    if (autoMount) {
      try { window.contextRender(autoMount); } catch(e){ log('auto render failed', e); }
    }
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      const autoMount = document.getElementById('smart-context-mount');
      if (autoMount) {
        try { window.contextRender(autoMount); } catch(e){ log('auto render failed', e); }
      }
    });
  }

  log('SMART CONTEXT: ready (renderer set)');
})();
