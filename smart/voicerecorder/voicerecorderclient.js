// voicerecorderclient.js — raw PCM (Float32) отправка каждые 2s
(function(){
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn  = document.getElementById('stopBtn');
  const canvas = document.getElementById('rec-wave');

  let audioCtx, micSource, recorderPort; // для worklet
  let procNode; // fallback ScriptProcessorNode
  let recording = false, paused = false;
  let buffers = []; // array of Float32Array
  let sampleRate = 48000;
  let seq = 0;
  let sendIntervalId = null;
  const CLIENT_ID = window.SMART_CLIENT_ID || 'unknown-client';

  function concatFloat32Arrays(arrays, totalLen){
    const res = new Float32Array(totalLen);
    let offset = 0;
    for (const a of arrays) {
      res.set(a, offset);
      offset += a.length;
    }
    return res;
  }

  async function sendRawPCM(float32Array, sequence){
    try {
      // отправляем ArrayBuffer сырого Float32 (LE)
      const payload = float32Array.buffer;
      const headers = {
        'X-Client-Id': CLIENT_ID,
        'X-Seq': String(sequence),
        'X-Sample-Rate': String(sampleRate),
        'X-Channels': '1',
        'X-BitDepth': '32f'
      };
      const resp = await fetch('/api/voicerecorder/upload-chunk', {
        method: 'POST',
        headers,
        body: payload
      });
      if (!resp.ok) {
        console.warn('upload-chunk response', resp.status);
      }
    } catch (err){
      console.error('sendRawPCM error', err);
    }
  }

  async function flushAndSend(){
    if (!buffers.length) return;
    const total = buffers.reduce((s,b)=>s+b.length,0);
    const merged = concatFloat32Arrays(buffers, total);
    seq++;
    await sendRawPCM(merged, seq);
    buffers = [];
  }

  function drawVU(level=0){
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#071018';
    ctx.fillRect(0,0,w,h);
    const bar = Math.round(Math.min(1, level) * w);
    const grad = ctx.createLinearGradient(0,0,w,0);
    grad.addColorStop(0, '#ff6b6b');
    grad.addColorStop(0.6, '#ffd66b');
    grad.addColorStop(1, '#6bffb8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h*0.15, bar, h*0.7);
  }

  function calcRMS(arr){
    let s=0;
    for (let i=0;i<arr.length;i++){ s += arr[i]*arr[i]; }
    return Math.sqrt(s/arr.length);
  }

  // ---------------- Audio setup ----------------
  async function startRecording(){
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate || 48000;
      micSource = audioCtx.createMediaStreamSource(stream);

      // try AudioWorklet
      if (audioCtx.audioWorklet) {
        try {
          await audioCtx.audioWorklet.addModule('./voicerecorder/recorder-processor.js');
          const node = new AudioWorkletNode(audioCtx, 'recorder-processor');
          node.port.onmessage = (e) => {
            if (!recording || paused) return;
            const chunk = e.data; // Float32Array transferred
            buffers.push(new Float32Array(chunk)); // ensure copy
            const rms = calcRMS(chunk);
            drawVU(Math.min(1, rms * 10));
          };
          micSource.connect(node);
          // don't connect node to destination (we don't want playback)
          recorderPort = node.port;
          procNode = node;
          console.log('Using AudioWorklet');
        } catch (weErr) {
          console.warn('AudioWorklet failed, falling back to ScriptProcessor:', weErr);
          setupScriptProcessor(stream);
        }
      } else {
        // fallback
        setupScriptProcessor(stream);
      }

      recording = true;
      paused = false;
      sendIntervalId = setInterval(()=> { if(recording && !paused) flushAndSend(); }, 2000);
      console.log('Recording started — client:', CLIENT_ID, 'sr', sampleRate);
    } catch (err){
      console.error('startRecording error', err);
      alert('Ошибка доступа к микрофону: ' + (err.message||err));
    }
  }

  function setupScriptProcessor(stream){
    // create ScriptProcessorNode as fallback
    const bufferSize = 4096;
    procNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    procNode.onaudioprocess = (e) => {
      if (!recording || paused) return;
      const input = e.inputBuffer.getChannelData(0);
      buffers.push(new Float32Array(input));
      const rms = calcRMS(input);
      drawVU(Math.min(1, rms * 10));
    };
    micSource.connect(procNode);
    procNode.connect(audioCtx.destination); // required in some browsers
  }

  function pauseRecording(){
    if (!recording) return;
    paused = !paused;
    console.log('Paused:', paused);
  }

  async function stopRecording(){
    if (!recording) return;
    recording = false;
    paused = false;
    if (sendIntervalId){ clearInterval(sendIntervalId); sendIntervalId = null; }
    await flushAndSend();
    // notify server that client finished
    try {
      await fetch('/api/voicerecorder/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, lastSeq: seq, sampleRate, channels:1, bitDepth:'32f' })
      });
    } catch(e){
      console.warn('finish notify error', e);
    }

    // stop audio nodes and tracks
    try {
      if (procNode && procNode.disconnect) procNode.disconnect();
      if (micSource && micSource.disconnect) micSource.disconnect();
      if (audioCtx) await audioCtx.close();
      // stop tracks in original stream if accessible
      // note: mediaStream is on the source.mediaStream in some browsers
      const tracks = streamGetTracksFromSource(micSource);
      if (tracks) tracks.forEach(t=>t.stop());
    } catch(e){ /* ignore */ }

    buffers = [];
    seq = 0;
    console.log('Recording stopped');
  }

  function streamGetTracksFromSource(source){
    try {
      // mediaStreamSource has .mediaStream in some implementations
      if (source && source.mediaStream && source.mediaStream.getTracks) return source.mediaStream.getTracks();
      // else try fallback: nothing
      return null;
    } catch(e){ return null; }
  }

  // bind buttons
  startBtn && startBtn.addEventListener('click', startRecording);
  pauseBtn && pauseBtn.addEventListener('click', pauseRecording);
  stopBtn  && stopBtn.addEventListener('click', stopRecording);

  // idle animation
  let idleT = 0;
  (function idleFrame(){
    if (!recording) {
      drawVU(0.02 + 0.01 * Math.sin(idleT));
      idleT += 0.05;
    }
    requestAnimationFrame(idleFrame);
  })();

})();
