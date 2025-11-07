
// =================== VoiceRecorder audio defaults (edit here) ===================
const VR_ECHO_CANCELLATION = false;     // boolean
const VR_NOISE_SUPPRESSION = false;     // boolean
const VR_AUTO_GAIN_CONTROL = false;      // boolean
const VR_MANUAL_GAIN      = 1;        // number (1.0 = unity)
// (removed) VR_TARGET_SAMPLE_RATE is handled downstream (wav-aggregator)
// ===============================================================================

// sv-audio-core.js
// Ядро: микрофон + AudioContext + Worklet. Теперь:
// - updateCaptureConstraints(flags): пробует применить echoCancellation / noiseSuppression / autoGainControl на лету
// - setGain(value): программный громкость через GainNode
// - hard-pause: pauseCapture()/resumeCapture()

export default class SVAudioCore {
  constructor(options = {}) {
    this._audioCtx = null;
    this._stream = null;
    this._source = null;
    this._gainNode = null;       // добавили
    this._recorderNode = null;

    this.onAudioFrame = null;

    this._chunkSize = options.chunkSize || 2048;
    this._workletUrl = options.workletUrl || 'voicerecorder/audiocore/recorder.worklet.js';

    this._paused = false;

    // храним последние известные флаги (для информации/логов)
    this._constraintsFlags = {
      echoCancellation: VR_ECHO_CANCELLATION,
      noiseSuppression: VR_NOISE_SUPPRESSION,
      autoGainControl: VR_AUTO_GAIN_CONTROL,
    };
  }

  async init() {
    if (this._audioCtx) return true;

    // NB: стартовые флаги можно подставлять сюда, если хочешь, но мы применяем их после init() через updateCaptureConstraints()
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: true // флаги докинем отдельным вызовом
    });

    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._audioCtx.state === 'suspended') {
      try { await this._audioCtx.resume(); } catch (e) {}
    }

    this._source = this._audioCtx.createMediaStreamSource(this._stream);

    
    // Apply default capture flags from constants
    await this.updateCaptureConstraints(this._constraintsFlags);
// добавили GainNode между source и recorder
    this._gainNode = this._audioCtx.createGain();
    this._gainNode.gain.value = VR_MANUAL_GAIN;

    await this._audioCtx.audioWorklet.addModule(this._workletUrl);
    this._recorderNode = new AudioWorkletNode(this._audioCtx, 'recorder-processor', {
      processorOptions: { chunkSize: this._chunkSize }
    });

    this._recorderNode.port.onmessage = (event) => {
      const { frame } = event.data || {};
      if (frame && this.onAudioFrame) this.onAudioFrame(frame);
    };

    // цепочка: source → gain → recorder
    this._source.connect(this._gainNode);
    this._gainNode.connect(this._recorderNode);
    this._paused = false;

    return true;
  }

  // ====== Функции для паузы (как раньше) ======
  pauseCapture() {
    if (!this._gainNode || !this._recorderNode || this._paused) return;
    try { this._gainNode.disconnect(this._recorderNode); } catch (e) {}
    this._paused = true;
  }

  resumeCapture() {
    if (!this._gainNode || !this._recorderNode || !this._paused) return;
    try { this._gainNode.connect(this._recorderNode); } catch (e) {}
    this._paused = false;
  }

  // ====== Гейн (программный) ======
  setGain(value) {
    if (!this._gainNode) return;
    const v = Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;
    this._gainNode.gain.value = v;
  }

  // ====== Флаги AEC/NS/AGC (пробуем применить на лету) ======
  async updateCaptureConstraints(partialFlags = {}) {
    // обновим локальную копию
    Object.assign(this._constraintsFlags, partialFlags);

    const track = this._stream?.getAudioTracks?.()[0];
    if (!track) return false;

    // Некоторые браузеры требуют advanced:
    const advanced = {};
    for (const k of ['echoCancellation','noiseSuppression','autoGainControl']) {
      if (k in partialFlags) advanced[k] = !!partialFlags[k];
    }
    if (Object.keys(advanced).length === 0) return true;

    try {
      // попытка применить на лету
      await track.applyConstraints({ advanced: [ advanced ] });
      // console.log('Applied constraints:', advanced);
      return true;
    } catch (e) {
      console.warn('applyConstraints failed, keeping previous stream:', e);
      // Простой путь: оставляем как есть. Если захочешь "жёстко" —
      // можно тут переинициализировать getUserMedia с нужными флагами и перебросить цепочку.
      return false;
    }
  }

  setChunkSize(n) {
    if (!this._recorderNode || !n) return;
    const sz = Math.max(128, Math.floor(n / 128) * 128);
    this._recorderNode.port.postMessage({ cmd: 'setChunkSize', chunkSize: sz });
  }

  getStream()  { return this._stream; }
  getContext() { return this._audioCtx; }
  getSource()  { return this._source;  }

  stop() {
    // разорвать граф
    if (this._gainNode && this._recorderNode) {
      try { this._gainNode.disconnect(this._recorderNode); } catch(e){}
    }
    if (this._source && this._gainNode) {
      try { this._source.disconnect(this._gainNode); } catch(e){}
    }
    if (this._recorderNode) {
      try { this._recorderNode.disconnect(); } catch(e){}
      this._recorderNode = null;
    }
    if (this._gainNode) {
      try { this._gainNode.disconnect(); } catch(e){}
      this._gainNode = null;
    }
    if (this._source) {
      try { this._source.disconnect(); } catch(e){}
      this._source = null;
    }

    // трек
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
