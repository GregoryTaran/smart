// voicerecorderclient.js
// Шаг 3: захват микрофона -> каждые 2s отправка WAV-чанка на /api/voicerecorder/upload-chunk
(() => {
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn  = document.getElementById('stopBtn');
  const canvas = document.getElementById('rec-wave');

  let audioCtx, micStream, proc;
  let recording = false, paused = false;
  let buffers = []; // массив Float32Array
  let sampleRate = 48000;
  let seq = 0;
  let sendIntervalId = null;

  const CLIENT_ID = window.SMART_CLIENT_ID || 'unknown-client';

  // helpers: float32 -> 16bit PCM
  function floatTo16BitPCM(output, offset, input){
    for (let i = 0; i < input.length; i++, offset += 2){
      let s = Math.max(-1, Math.min(1, input[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      output.setInt16(offset, s, true);
    }
  }

  function encodeWAV(samples, sampleRate){
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    function writeString(view, offset, string){
      for (let i = 0; i < string.length; i++){
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * blockAlign)
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    floatTo16BitPCM(view, 44, samples);
    return new Blob([view], { type: 'audio/wav' });
  }

  function mergeBuffers(buffers, len){
    const result = new Float32Array(len);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++){
      result.set(buffers[i], offset);
      offset += buffers[i].length;
    }
    return result;
  }

  // отправка чанка на сервер
  async function sendChunk(wavBlob, sequence){
    try {
      const fd = new FormData();
      fd.append('clientId', CLIENT_ID);
      fd.append('seq', sequence);
      fd.append('sampleRate', sampleRate);
      fd.append('chunk', wavBlob, `chunk-${sequence}.wav`);
      const resp = await fetch('/api/voicerecorder/upload-chunk', {
        method: 'POST',
        body: fd
      });
      // debug
      // console.log('chunk sent', sequence, resp.status);
    } catch (err){
      console.error('sendChunk error', err);
    }
  }

  // flush буфера -> WAV -> отправка
  async function flushAndSend(){
    if (!buffers.length) return;
    // объединяем и конвертируем
    let totalLen = buffers.reduce((s, b) => s + b.length, 0);
    const merged = mergeBuffers(buffers, totalLen);
    const wav = encodeWAV(merged, sampleRate);
    seq++;
    await sendChunk(wav, seq);
    buffers = [];
  }

  // отрисовка индикатора: берём RMS последнего буфера
  function drawVU(level = 0){
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    // фон
    ctx.fillStyle = '#071018';
    ctx.fillRect(0,0,w,h);
    // уровень
    const barWidth = Math.max(2, Math.round(level * w));
    const grad = ctx.createLinearGradient(0,0,w,0);
    grad.addColorStop(0, '#ff6b6b');
    grad.addColorStop(0.5, '#ffd66b');
    grad.addColorStop(1, '#6bffb8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h*0.15, barWidth, h*0.7);
  }

  function calcRMS(float32Array){
    let sum = 0;
    for (let i=0;i<float32Array.length;i++){
      const v = float32Array[i];
      sum += v*v;
    }
    return Math.sqrt(sum/float32Array.length);
  }

  // start: запрос микрофона и подключение ScriptProcessor
  async function startRecording(){
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate || 48000;
      micStream = audioCtx.createMediaStreamSource(stream);

      // bufferSize 4096 (latency moderate). Можно 2048/4096.
      const bufferSize = 4096;
      proc = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      proc.onaudioprocess = (e) => {
        if (!recording || paused) return;
        const input = e.inputBuffer.getChannelData(0);
        // копируем данные
        buffers.push(new Float32Array(input));
        // индикатор: RMS от последнего сэмпла
        const rms = calcRMS(input);
        drawVU(Math.min(1, rms * 10)); // масштабируем для видимости
      };

      micStream.connect(proc);
      proc.connect(audioCtx.destination); // необходима связка в некоторых браузерах

      recording = true;
      paused = false;
      // каждые 2s флешим накопленные буферы
      sendIntervalId = setInterval(() => {
        if (!recording || paused) return;
        flushAndSend();
      }, 2000);
      console.log('Recording started — client:', CLIENT_ID);
    } catch (err){
      console.error('Microphone access denied or error', err);
      alert('Не удалось получить доступ к микрофону: ' + (err.message||err));
    }
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
    if (sendIntervalId) { clearInterval(sendIntervalId); sendIntervalId = null; }
    // последний flush
    await flushAndSend();
    // уведомить сервер о завершении записи (чтобы он мог склеить)
    try {
      await fetch('/api/voicerecorder/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, lastSeq: seq })
      });
    } catch(e){ console.warn('finish notify error', e); }

    // остановка аудио
    try {
      proc && proc.disconnect();
      micStream && micStream.disconnect();
      audioCtx && audioCtx.close();
      // остановить все треки
      const tracks = micStream && micStream.mediaStream && micStream.mediaStream.getTracks ? micStream.mediaStream.getTracks() : null;
      if (tracks) tracks.forEach(t => t.stop());
    } catch (e){ /* ignore */ }

    buffers = [];
    seq = 0;
    console.log('Recording stopped');
  }

  // кнопки
  startBtn && startBtn.addEventListener('click', startRecording);
  pauseBtn && pauseBtn.addEventListener('click', pauseRecording);
  stopBtn  && stopBtn.addEventListener('click', stopRecording);

  // небольшая анимация когда не записываем (чтобы UI не пустой)
  let idleT = 0;
  function idleFrame(){
    if (!recording) {
      drawVU(0.02 + 0.01 * Math.sin(idleT));
      idleT += 0.05;
    }
    requestAnimationFrame(idleFrame);
  }
  idleFrame();
})();
