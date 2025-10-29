// voicerecorderclient.js
// Minimal robust client for sending raw Float32 PCM chunks to /api/voicerecorder/upload-chunk
// - uses AudioWorklet when available, falls back to ScriptProcessor
// - accumulates frames to reduce too-small chunks
// - sends binary via Blob(...), Content-Type application/octet-stream
// - includes X-Client-Id header and debug logging

(() => {
  // ----- Config -----
  const FLUSH_SAMPLES_THRESHOLD = 4096 * 2; // send when total samples >= this (tweak if needed)
  const FLUSH_INTERVAL_MS = 250; // periodic flush in ms (safety)
  const CHANNELS = 1; // mono client currently
  const DEFAULT_SAMPLE_RATE = 48000;

  // ----- Utils -----
  function uuidv4() {
    // simple UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getClientId() {
    if (window.SMART_CLIENT_ID) return window.SMART_CLIENT_ID;
    try {
      const key = 'smart_client_id_v1';
      let id = localStorage.getItem(key);
      if (!id) {
        id = uuidv4();
        localStorage.setItem(key, id);
      }
      window.SMART_CLIENT_ID = id;
      return id;
    } catch (e) {
      // localStorage may fail in some contexts — fallback
      if (!window.SMART_CLIENT_ID) window.SMART_CLIENT_ID = uuidv4();
      return window.SMART_CLIENT_ID;
    }
  }

  // ----- Transport -----
  async function sendRawPCM(arrayBuffer, sequence, sampleRate) {
    try {
      const payload = arrayBuffer;
      console.log('[voicerecorder] sending chunk bytes=', payload.byteLength, 'seq=', sequence);

      const headers = {
        'X-Client-Id': CLIENT_ID,
        'X-Seq': String(sequence),
        'X-Sample-Rate': String(sampleRate || SAMPLE_RATE),
        'X-Channels': String(CHANNELS),
        'X-BitDepth': '32f',
        'Content-Type': 'application/octet-stream'
      };

      const resp = await fetch('/api/voicerecorder/upload-chunk', {
        method: 'POST',
        headers,
        body: new Blob([payload]) // explicit blob to ensure binary transport
      });

      if (!resp.ok) {
        console.warn('[voicerecorder] upload-chunk response', resp.status, await resp.text());
      } else {
        // optional: read json
        try {
          const j = await resp.json();
          // debug:
          // console.log('[voicerecorder] upload ack', j);
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error('[voicerecorder] sendRawPCM error', err);
    }
  }

  // ----- Buffer accumulation -----
  let pendingBuffers = []; // array of Float32Array
  let pendingSamples = 0;
  let seqCounter = 0;

  function pushBuffer(float32arr) {
    pendingBuffers.push(float32arr);
    pendingSamples += float32arr.length;
    // If threshold reached, flush immediately
    if (pendingSamples >= FLUSH_SAMPLES_THRESHOLD) {
      flushBuffers();
    }
  }

  async function flushBuffers() {
    if (pendingSamples === 0) return;
    // concat into single Float32Array
    const out = new Float32Array(pendingSamples);
    let offset = 0;
    for (const buf of pendingBuffers) {
      out.set(buf, offset);
      offset += buf.length;
    }
    // reset queue
    pendingBuffers = [];
    pendingSamples = 0;
    seqCounter += 1;

    // send as ArrayBuffer (Float32 LE)
    const ab = out.buffer;
    await sendRawPCM(ab, seqCounter, SAMPLE_RATE);
  }

  // periodic flush to ensure small recordings are sent
  let flushIntervalHandle = null;
  function startFlushInterval() {
    if (flushIntervalHandle) return;
    flushIntervalHandle = setInterval(() => {
      flushBuffers();
    }, FLUSH_INTERVAL_MS);
  }
  function stopFlushInterval() {
    if (!flushIntervalHandle) return;
    clearInterval(flushIntervalHandle);
    flushIntervalHandle = null;
  }

  // ----- Audio capture (AudioWorklet preferred) -----
  let audioCtx = null;
  let recorderNode = null;
  let microphoneStream = null;
  let isRecording = false;
  let SAMPLE_RATE = DEFAULT_SAMPLE_RATE;
  const CLIENT_ID = getClientId();

  async function initAudioWorklet() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    SAMPLE_RATE = audioCtx.sampleRate || DEFAULT_SAMPLE_RATE;
    // load worklet processor (assumes recorder-processor.js exists and registers 'recorder.processor')
    try {
      if (audioCtx.audioWorklet) {
        await audioCtx.audioWorklet.addModule('/recorder-processor.js');
        // create node that posts Float32Array chunks via port messages
        recorderNode = new AudioWorkletNode(audioCtx, 'recorder.processor', { numberOfOutputs: 0, numberOfInputs: 1, channelCount: CHANNELS });
        recorderNode.port.onmessage = (e) => {
          // e.data expected to be Float32Array or transferable buffer
          const data = e.data;
          // normalize to Float32Array
          let arr;
          if (data instanceof Float32Array) {
            arr = data;
          } else if (data && data.buffer) {
            arr = new Float32Array(data.buffer);
          } else if (Array.isArray(data)) {
            arr = new Float32Array(data);
          } else {
            // ignore unknown messages
            return;
          }
          pushBuffer(arr);
        };
        return true;
      }
    } catch (err) {
      console.warn('[voicerecorder] AudioWorklet init failed', err);
      // fallback to ScriptProcessor
    }
    return false;
  }

  async function initScriptProcessor(streamNode) {
    // fallback approach using ScriptProcessorNode
    try {
      const bufferSize = 4096;
      recorderNode = audioCtx.createScriptProcessor(bufferSize, CHANNELS, CHANNELS);
      recorderNode.onaudioprocess = (evt) => {
        const inputBuffer = evt.inputBuffer.getChannelData(0);
        // clone to avoid referencing shared memory
        const copy = new Float32Array(inputBuffer.length);
        copy.set(inputBuffer);
        pushBuffer(copy);
      };
      streamNode.connect(recorderNode);
      recorderNode.connect(audioCtx.destination); // required in some browsers
      return true;
    } catch (err) {
      console.error('[voicerecorder] ScriptProcessor init failed', err);
      return false;
    }
  }

  // ----- Public controls -----
  async function startRecording() {
    if (isRecording) return;
    seqCounter = 0;
    try {
      // request microphone
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      console.error('[voicerecorder] getUserMedia failed', err);
      return;
    }

    const hadAudioCtx = !!audioCtx;
    const useWorklet = !hadAudioCtx; // if audioCtx already exists maybe worklet already loaded

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      SAMPLE_RATE = audioCtx.sampleRate || DEFAULT_SAMPLE_RATE;
    }

    const source = audioCtx.createMediaStreamSource(microphoneStream);

    const workletOk = await initAudioWorklet();
    if (workletOk && recorderNode && recorderNode.port) {
      // connect source to worklet node
      source.connect(recorderNode);
      // note: recorderWorklet should not be connected to audioCtx.destination because it's a processor-only node
    } else {
      // fallback: use ScriptProcessor approach
      await initScriptProcessor(source);
    }

    // if recorderNode is a worklet node with no outputs, still hook up source appropriately:
    try {
      if (recorderNode && recorderNode.connect && recorderNode.numberOfOutputs > 0) {
        recorderNode.connect(audioCtx.destination);
      }
    } catch (e) {
      // ignore
    }

    startFlushInterval();
    isRecording = true;
    console.log('[voicerecorder] Recording started — client:', CLIENT_ID, 'sr', SAMPLE_RATE);
  }

  async function stopRecording() {
    if (!isRecording) return;
    // flush remaining buffers
    await flushBuffers();
    stopFlushInterval();

    // disconnect nodes and close stream
    try {
      if (recorderNode) {
        try { recorderNode.disconnect(); } catch(e){}
        try { recorderNode.port && recorderNode.port.onmessage && (recorderNode.port.onmessage = null); } catch(e){}
        recorderNode = null;
      }
      if (microphoneStream) {
        const tracks = microphoneStream.getTracks();
        for (const t of tracks) t.stop();
        microphoneStream = null;
      }
      // do not close audioCtx here; we can leave it open for quick starts
    } catch (err) {
      console.warn('[voicerecorder] error during stop cleanup', err);
    }

    isRecording = false;
    console.log('[voicerecorder] Recording stopped');

    // call finish endpoint to finalize file (no convert by default)
    try {
      const finishResp = await fetch('/api/voicerecorder/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, filename: `${Date.now()}-${CLIENT_ID}.raw` })
      });
      const j = await finishResp.json();
      console.log('[voicerecorder] finish result', j);
      // optionally show url to user
    } catch (err) {
      console.error('[voicerecorder] finish request failed', err);
    }
  }

  // ----- Expose API to window -----
  window.SmartVoiceRecorder = {
    start: startRecording,
    stop: stopRecording,
    isRecording: () => isRecording,
    clientId: CLIENT_ID
  };

  // If you want to auto-wire buttons (if they exist)
  document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('vr-start');
    const stopBtn = document.getElementById('vr-stop');
    if (startBtn) startBtn.addEventListener('click', () => window.SmartVoiceRecorder.start());
    if (stopBtn) stopBtn.addEventListener('click', () => window.SmartVoiceRecorder.stop());
  });

})();
