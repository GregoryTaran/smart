// voicerecorder.js — интеграция (без автоподключений индикатора)
// Делай резервную копию перед заменой: cp voicerecorder/voicerecorder.js voicerecorder/voicerecorder.js.bak

const ROOT = document.querySelector('#main[data-module="voicerecorder"]');
if (!ROOT) throw new Error('voicerecorder: root not found');

const BTN_START = ROOT.querySelector('#vc-btn-start');
const BTN_PAUSE = ROOT.querySelector('#vc-btn-pause');
const BTN_STOP  = ROOT.querySelector('#vc-btn-stop');
const STATUS    = ROOT.querySelector('#vc-status');
const AUDIO_EL  = ROOT.querySelector('#vc-audio');
const DOWNLOAD  = ROOT.querySelector('#vc-download');
const TRANSCRIPT= ROOT.querySelector('#vc-transcript');

let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let workletNode = null;
let analyser = null;
let recording = false;
let ws = null;

// Paths as in stable system — корректируй если у тебя по-другому
const WORKLET_PATH = 'voicerecorder/audioworklet-processor.js';
const WS_PATH = '/ws/voicerecorder';

function log(text) {
  if (STATUS) STATUS.textContent = text;
  console.log('[vc]', text);
}

function buildWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => log('WS connected');
    ws.onclose = () => log('WS closed');
    ws.onerror = (e) => { console.error(e); log('WS error'); };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'result') {
          if (m.mp3_url) {
            AUDIO_EL.src = m.mp3_url;
            DOWNLOAD.href = m.mp3_url;
            DOWNLOAD.style.display = '';
          }
          if (m.transcript) TRANSCRIPT.textContent = m.transcript;
          log('Получен результат');
        }
      } catch (e) {}
    };
  } catch (e) {
    console.warn('WS ctor failed', e);
  }
}

async function startRecording() {
  try {
    buildWebSocket();

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);

    // AudioWorklet (если есть) — оставляем как в стабильной версии
    try {
      if (audioCtx.audioWorklet && typeof audioCtx.audioWorklet.addModule === 'function') {
        await audioCtx.audioWorklet.addModule(WORKLET_PATH);
        workletNode = new AudioWorkletNode(audioCtx, 'chunker-processor');
        const silent = audioCtx.createGain(); silent.gain.value = 0;
        workletNode.connect(silent); silent.connect(audioCtx.destination);
        sourceNode.connect(workletNode);

        workletNode.port.onmessage = (e) => {
          const d = e.data;
          if (!d) return;
          if (d.type === 'chunk' && d.buffer) {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'chunk_meta', chunk_samples: d.valid_samples, sample_rate: audioCtx.sampleRate }));
              ws.send(d.buffer);
            }
          } else if (d.type === 'level') {
            // не форвардим в индикатор автоматически — индикатор использует свой анализатор
          }
        };
      } else {
        // fallback analyser if no worklet — used only for visual debug, not sent as chunks
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        sourceNode.connect(analyser);
      }
    } catch (e) {
      console.warn('worklet load failed', e);
    }

    // === ВАЖНО: подключаем индикатор ТОЛЬКО ЗДЕСЬ, после получения mediaStream ===
    try {
      const indicator = window._SV_MIC_INDICATOR;
      if (indicator && typeof indicator.connectStream === 'function') {
        await indicator.connectStream(mediaStream);
      }
    } catch (e) {
      console.warn('indicator.connectStream failed', e);
    }

    // notify server that recording started
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start', sample_rate: audioCtx.sampleRate }));
    }

    recording = true;
    BTN_START.disabled = true;
    BTN_STOP.disabled = false;
    BTN_PAUSE.disabled = false;
    log('Recording...');
  } catch (err) {
    console.error('startRecording error', err);
    log('Ошибка: не удалось начать запись. Откройте консоль.');
  }
}

function stopRecording() {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    }

    // отключаем индикатор (останавливаем визуал), не удаляя сам DOM индикатора
    try {
      const indicator = window._SV_MIC_INDICATOR;
      if (indicator && typeof indicator.disconnect === 'function') {
        indicator.disconnect();
      }
    } catch (e) {}

    if (workletNode) try { workletNode.disconnect(); } catch (e) {}
    if (analyser) try { analyser.disconnect(); } catch (e) {}
    if (sourceNode) try { sourceNode.disconnect(); } catch (e) {}
    if (mediaStream) try { mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    if (audioCtx) try { audioCtx.close(); } catch (e) {}

    recording = false;
    BTN_START.disabled = false;
    BTN_STOP.disabled = true;
    BTN_PAUSE.disabled = true;
    log('Stopped');
  } catch (e) {
    console.error(e);
  }
}

BTN_START.addEventListener('click', () => { if (!recording) startRecording(); });
BTN_STOP.addEventListener('click', () => { if (recording) stopRecording(); });
BTN_PAUSE.addEventListener('click', () => {
  if (!audioCtx) return;
  if (audioCtx.state === 'running') {
    audioCtx.suspend().then(() => { BTN_PAUSE.textContent = 'RESUME'; log('Paused'); });
  } else {
    audioCtx.resume().then(() => { BTN_PAUSE.textContent = 'PAUSE'; log('Resumed'); });
  }
});
