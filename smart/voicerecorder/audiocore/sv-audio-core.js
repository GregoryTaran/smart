// =================== Настройки аудио (правь тут) ===================
const VR_ECHO_CANCELLATION = false;      // Эхо-подавление браузера
const VR_NOISE_SUPPRESSION = false;      // Подавление шума браузера
const VR_AUTO_GAIN_CONTROL = false;      // Автогромкость (AGC) браузера
const VR_MANUAL_GAIN      = 1.0;         // Ручной входной гейн до компрессора (1.0 = без изменений)

// ===== Компрессор / Лимитер / Make‑up (основные ручки) =====
const VR_ENABLE_COMPRESSOR   = true;     // Включить звено компрессора
const VR_COMP_THRESHOLD_DB   = -24;      // Порог: всё громче этого уровня будет сжиматься (дБ)
const VR_COMP_KNEE_DB        = 30;       // «Плавность» перехода (knee), дБ
const VR_COMP_RATIO          = 12;       // Степень сжатия (отношение). 8–12 — хороший старт
const VR_COMP_ATTACK_SEC     = 0.003;    // Скорость срабатывания (сек)
const VR_COMP_RELEASE_SEC    = 0.1;     // Скорость восстановления (сек)

// Make‑up gain: общий подъём после сжатия (множитель). 1.5 ≈ +3.5 дБ
const VR_MAKEUP_GAIN         = 1.5;      // 1.0–3.0 обычно достаточно

// Необязательный «авто‑make‑up»: плавно подстраивает make‑up по reduction компрессора
const VR_AUTOMAKEUP_ENABLED  = false;    // Включить авто‑подстройку make‑up
const VR_AUTOMAKEUP_MIN      = 1.0;      // Нижняя граница make‑up
const VR_AUTOMAKEUP_MAX      = 3.0;      // Верхняя граница make‑up
const VR_AUTOMAKEUP_STEP_UP  = 0.02;     // Шаг увеличения за тик
const VR_AUTOMAKEUP_STEP_DN  = 0.01;     // Шаг уменьшения за тик
const VR_AUTOMAKEUP_MS       = 120;      // Интервал опроса компрессора (мс)
const VR_AUTOMAKEUP_TARGET_DB= -6;       // Цель по среднему сжатию (дБ)
const VR_AUTOMAKEUP_DEADBAND = 2;        // Гистерезис, ±дБ вокруг цели (чтобы не дёргалось)
// ===================================================================

// sv-audio-core.js
// Ядро: микрофон + AudioContext + Worklet с компрессором и make‑up.
// Сигнальная цепочка:
//   source (MediaStream) → preGain (ручной) → [compressor] → [makeupGain] → recorder (Worklet)
// Квадратные скобки означают узлы, которые присутствуют только когда VR_ENABLE_COMPRESSOR = true.

export default class SVAudioCore {
  constructor(options = {}) {
    this._audioCtx = null;
    this._stream = null;
    this._source = null;

    this._preGain = null;        // Ручной гейн ДО компрессора (влияет на «наезд» на порог)
    this._compressor = null;     // DynamicsCompressorNode
    this._makeupGain = null;     // GainNode ПОСЛЕ компрессора
    this._recorderNode = null;   // AudioWorkletNode-приёмник фреймов

    this._autoMakeupTimer = null; // Таймер авто‑make‑up (если включён)

    this.onAudioFrame = null;     // Колбэк: (Float32Array frame) => void

    this._chunkSize = options.chunkSize || 2048; // размер чанка для ворклета
    this._workletUrl = options.workletUrl || 'voicerecorder/audiocore/recorder.worklet.js';

    this._paused = false;

    // Запоминаем текущие желаемые флаги захвата (для логики updateCaptureConstraints)
    this._constraintsFlags = {
      echoCancellation: VR_ECHO_CANCELLATION,
      noiseSuppression: VR_NOISE_SUPPRESSION,
      autoGainControl: VR_AUTO_GAIN_CONTROL,
    };
  }

  // Инициализация графа аудио и ворклета
  async init() {
    if (this._audioCtx) return true;

    // 1) Запрос аудио‑потока (флаги применим отдельно через applyConstraints)
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 2) Аудио‑контекст
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._audioCtx.state === 'suspended') {
      try { await this._audioCtx.resume(); } catch (e) {}
    }

    // 3) Источник из MediaStream
    this._source = this._audioCtx.createMediaStreamSource(this._stream);

    // 4) Применим стартовые системные флаги (эхо/шум/AGC), насколько позволяет устройство/браузер
    await this.updateCaptureConstraints(this._constraintsFlags);

    // 5) Узлы обработки
    this._preGain = this._audioCtx.createGain();
    this._preGain.gain.value = VR_MANUAL_GAIN;

    if (VR_ENABLE_COMPRESSOR) {
      this._compressor = this._audioCtx.createDynamicsCompressor();
      this._compressor.threshold.value = VR_COMP_THRESHOLD_DB;
      this._compressor.knee.value      = VR_COMP_KNEE_DB;
      this._compressor.ratio.value     = VR_COMP_RATIO;
      this._compressor.attack.value    = VR_COMP_ATTACK_SEC;
      this._compressor.release.value   = VR_COMP_RELEASE_SEC;

      this._makeupGain = this._audioCtx.createGain();
      this._makeupGain.gain.value = VR_MAKEUP_GAIN;
    }

    // 6) Готовим Worklet‑процессор (он только собирает чанки и отдаёт наружу кадры Float32Array)
    await this._audioCtx.audioWorklet.addModule(this._workletUrl);
    this._recorderNode = new AudioWorkletNode(this._audioCtx, 'recorder-processor', {
      processorOptions: { chunkSize: this._chunkSize }
    });
    this._recorderNode.port.onmessage = (event) => {
      const { frame } = event.data || {};
      if (frame && this.onAudioFrame) this.onAudioFrame(frame);
    };

    // 7) Коммутация графа
    // Базовый вариант: source → preGain → recorder
    // Вариант с компрессором: source → preGain → compressor → makeupGain → recorder
    this._source.connect(this._preGain);
    if (this._compressor && this._makeupGain) {
      this._preGain.connect(this._compressor);
      this._compressor.connect(this._makeupGain);
      this._makeupGain.connect(this._recorderNode);

      if (VR_AUTOMAKEUP_ENABLED) this.startAutoMakeup();
    } else {
      this._preGain.connect(this._recorderNode);
    }

    this._paused = false;
    return true;
  }

  // ===== Пауза/резюм захвата (просто рвём/восстанавливаем связи) =====
  pauseCapture() {
    if (!this._preGain || !this._recorderNode || this._paused) return;
    try { this._preGain.disconnect(this._recorderNode); } catch (e) {}
    try { this._compressor?.disconnect(this._makeupGain || this._recorderNode); } catch (e) {}
    try { this._makeupGain?.disconnect(this._recorderNode); } catch (e) {}
    this._paused = true;
  }

  resumeCapture() {
    if (!this._preGain || !this._recorderNode || !this._paused) return;
    try {
      if (this._compressor && this._makeupGain) {
        this._preGain.connect(this._compressor);
        this._compressor.connect(this._makeupGain);
        this._makeupGain.connect(this._recorderNode);
      } else {
        this._preGain.connect(this._recorderNode);
      }
    } catch (e) {}
    this._paused = false;
  }

  // ===== Ручной гейн ДО компрессора =====
  setGain(value) {
    if (!this._preGain) return;
    const v = Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;
    this._preGain.gain.value = v;
  }

  // ===== Make‑up ПОСЛЕ компрессора =====
  setMakeupGain(value) {
    if (!this._makeupGain) return;
    const v = Number.isFinite(value) ? Math.max(0, Math.min(6, value)) : 1;
    this._makeupGain.gain.value = v;
  }

  // ===== Системные флаги AEC/NS/AGC (попытка применить «на лету») =====
  async updateCaptureConstraints(partialFlags = {}) {
    Object.assign(this._constraintsFlags, partialFlags);

    const track = this._stream?.getAudioTracks?.()[0];
    if (!track) return false;

    // Некоторые браузеры понимают только advanced
    const advanced = {};
    for (const k of ['echoCancellation','noiseSuppression','autoGainControl']) {
      if (k in partialFlags) advanced[k] = !!partialFlags[k];
    }
    if (Object.keys(advanced).length === 0) return true;

    try {
      await track.applyConstraints({ advanced: [ advanced ] });
      return true;
    } catch (e) {
      console.warn('applyConstraints не сработал, оставляем текущий поток:', e);
      return false;
    }
  }

  // ===== Параметры ворклета =====
  setChunkSize(n) {
    if (!this._recorderNode || !n) return;
    const sz = Math.max(128, Math.floor(n / 128) * 128); // размер должен быть кратен 128
    this._recorderNode.port.postMessage({ cmd: 'setChunkSize', chunkSize: sz });
  }

  // ===== Авто‑make‑up (медленная, аккуратная подстройка громкости после компрессора) =====
  startAutoMakeup(opts = {}) {
    if (!this._compressor || !this._makeupGain) return;
    this.stopAutoMakeup();

    const {
      min = VR_AUTOMAKEUP_MIN,
      max = VR_AUTOMAKEUP_MAX,
      stepUp = VR_AUTOMAKEUP_STEP_UP,
      stepDown = VR_AUTOMAKEUP_STEP_DN,
      intervalMs = VR_AUTOMAKEUP_MS,
      targetReduction = VR_AUTOMAKEUP_TARGET_DB,
      deadband = VR_AUTOMAKEUP_DEADBAND,
    } = opts;

    this._autoMakeupTimer = setInterval(() => {
      const r = this._compressor.reduction; // Текущее сжатие (дБ, отрицательное)
      let g = this._makeupGain.gain.value;
      if (!Number.isFinite(r)) return;

      // Если сжатия меньше цели → понемногу уменьшаем make‑up;
      // Если больше цели → понемногу увеличиваем make‑up.
      if (r > (targetReduction + deadband)) {
        g = Math.max(min, g - stepDown);
      } else if (r < (targetReduction - deadband)) {
        g = Math.min(max, g + stepUp);
      }
      this._makeupGain.gain.value = g;
    }, intervalMs);
  }

  stopAutoMakeup() {
    if (this._autoMakeupTimer) {
      clearInterval(this._autoMakeupTimer);
      this._autoMakeupTimer = null;
    }
  }

  // ===== Вспомогательные методы =====
  getStream()  { return this._stream; }
  getContext() { return this._audioCtx; }
  getSource()  { return this._source;  }

  // Корректное завершение работы и очистка графа
  stop() {
    this.stopAutoMakeup();

    // Разрываем соединения
    try { this._makeupGain?.disconnect(); } catch(e){}
    try { this._compressor?.disconnect(); } catch(e){}
    try { this._preGain?.disconnect(); } catch(e){}
    try { this._recorderNode?.disconnect(); } catch(e){}

    this._recorderNode = null;
    this._makeupGain = null;
    this._compressor = null;
    this._preGain = null;

    if (this._source) {
      try { this._source.disconnect(); } catch(e){}
      this._source = null;
    }

    if (this._stream) {
      this._stream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
      this._stream = null;
    }

    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch(e){}
      this._audioCtx = null;
    }

    this._paused = false;
  }

  destroy() {
    this.stop();
    this.onAudioFrame = null;
  }
}
