import SVAudioCore from './audiocore/sv-audio-core.js';
import MicIndicator from './mic-indicator/mic-indicator.js';
import WavSegmenter from './audiocore/wav-segmenter.js';
import WavAssembler from './audiocore/wav-assembler.js';
import { uuidv4 } from '../uuid/uuid.js';
import { rid } from '../uuid/id.js';

// -------------------- DOM --------------------
const playerEl = document.getElementById('sv-player');
const container = document.getElementById('vc-level');
const startBtn  = document.getElementById('startBtn');
const pauseBtn  = document.getElementById('pauseBtn');
const stopBtn   = document.getElementById('stopBtn');
const statusEl  = document.getElementById('status');

const anonEl = document.getElementById('anon-id');
const sessEl = document.getElementById('session-id');
const recEl  = document.getElementById('recording-id');

// -------------------- Core --------------------
const core = new SVAudioCore();             // захватчик (AEC/NS/AGC/Gain внутри sv-audio-core.js)
const mic  = new MicIndicator(container);   // только визуализация уровня

// Сегментер = режет на 2сек куски, последний паддит до 2 сек тишиной (по твоей логике)
const segments = [];
const segmenter = new WavSegmenter({
  segmentSeconds: 2,
  normalize: true,
  normalizeTarget: 0.99,
  emitBlobPerSegment: false,
  padLastSegment: true,
});

segmenter.onSegment = (seg) => {
  segments.push(seg);
  // Тут легко добавить: отправку seg.pcmInt16 или seg.blob на сервер
};

// Ассемблер = собирает финальный WAV из списка сегментов (сегодня на клиенте; завтра можно делать на сервере)
const assembler = new WavAssembler({
  // targetSampleRate: 16000, // включи при необходимости
});

// -------------------- Identity --------------------
(function initIdentity(){
  const anonKey = 'sv_anon_user_id';
  const sessKey = 'sv_session_id';
  let anon = null, session = null;
  try { anon = localStorage.getItem(anonKey); if (!anon) { anon = uuidv4(); localStorage.setItem(anonKey, anon); } } catch { anon = uuidv4(); }
  try { session = sessionStorage.getItem(sessKey); if (!session) { session = uuidv4(); sessionStorage.setItem(sessKey, session); } } catch { session = uuidv4(); }
  if (anonEl) anonEl.textContent = anon;
  if (sessEl) sessEl.textContent = session;
})();

// -------------------- State --------------------
let lastObjectUrl = null;
let localStream = null;
let recordingId = null;
let paused      = false;

// -------------------- Controls --------------------
async function start() {
  // reset preview player at the start of a new recording
  try {
    if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
  } catch {}
  if (playerEl) {
    playerEl.pause?.();
    playerEl.removeAttribute('src');
    try { playerEl.load?.(); } catch {}
    playerEl.classList.add('sv-player--disabled');
  }
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  stopBtn.disabled  = true;
  statusEl.textContent = 'requesting…';
  recordingId = uuidv4();
  if (recEl) recEl.textContent = recordingId;

  try {
    await core.init();                         // поднимет граф и применит VR_* флаги внутри
    localStream = core.getStream();            // отдать поток индикатору
    await mic.connectStream(localStream);

    // сообщим частоту сегментеру
    const sr = core.getContext()?.sampleRate || 48000;
    segmenter.setSampleRate(sr);

    // подписка на аудиокадры
    core.onAudioFrame = (frame) => segmenter.pushFrame(frame);

    statusEl.textContent = 'running';
    stopBtn.disabled = false;
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'error';
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled  = true;
  }
}

function pause() {
  if (!paused) {
    try { mic._stopTimer?.(); } catch {}
    core.pauseCapture?.();
    paused = true;
    pauseBtn.textContent = 'Resume';
    statusEl.textContent = 'paused';
  } else {
    try { mic._startTimer?.(); } catch {}
    core.resumeCapture?.();
    paused = false;
    pauseBtn.textContent = 'Pause';
    statusEl.textContent = 'running';
  }
}

function stop() {
  // 1) Закончим сегментацию (эмитит финальный, паддед до 2 сек сегмент)
  segmenter.stop();

  // 2) Соберём финальный WAV из всех сегментов
  assembler.clear();
  for (const s of segments) assembler.addSegment(s);
  const big = assembler.buildFinalWav();

  // 3) Preview in persistent media player (no auto-download)
  const url = URL.createObjectURL(big);
  try { if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl); } catch {}
  lastObjectUrl = url;
  if (playerEl) {
    playerEl.src = url;
    playerEl.classList.remove('sv-player--disabled');
    // optional: autoplay next line if desired
    // try { playerEl.play?.(); } catch {}
  }

  // 4) Остановить аудио/индикатор
  try { core.stop?.(); } catch {}
  try { mic.disconnect?.(); } catch {}

  statusEl.textContent = 'stopped';
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled  = true;
  pauseBtn.textContent = 'Pause';
  paused = false;

  // 5) Очистим списки на новую запись
  segments.length = 0;
}

// -------------------- Wire UI --------------------
startBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', pause);
stopBtn.addEventListener('click', stop);

window.addEventListener('beforeunload', () => {
  try { core.destroy?.(); } catch {}
  try { mic.destroy?.(); } catch {}
});
