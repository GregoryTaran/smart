// mic-indicator.js
// Mic Indicator v2 — с логикой состояний: initial / working / pause
// Состояния:
//   initial — модуль загружен, ждет звука, рисует только baseline
//   working — есть звук выше порога, рисует активные бары
//   pause   — тишина дольше заданного времени, фиксирует последний кадр
//
// Модуль полностью визуальный, не эмитит событий наружу.

const DEFAULTS = {
  stepMs: 100,
  fftSize: 1024,
  analyserSmoothing: 0.2,
  sensitivity: 5,
  exponent: 0.95,
  minVisible: 0.01,
  minBars: 6,
  peakMultiplier: 5,
  peakDecay: 0.98,
  bufDecay: 1,
  barWidthPx: null,
  gapPx: null,
  // новые параметры:
  silenceThreshold: 0.02,   // уровень звука, ниже которого — тишина
  silenceTimeoutMs: 5000    // сколько мс подряд тишины до состояния pause
};

export default class MicIndicator {
  static setDefaults(o = {}) { Object.assign(DEFAULTS, o); }

  constructor(container, opts = {}) {
    if (!(container instanceof Element)) throw new Error('MicIndicator: container must be a DOM Element');
    this.container = container;
    const d = container.dataset || {};
    const data = {};
    if (d.stepMs) data.stepMs = Number(d.stepMs);
    if (d.sensitivity) data.sensitivity = Number(d.sensitivity);
    if (d.fftSize) data.fftSize = Number(d.fftSize);
    this.opts = Object.assign({}, DEFAULTS, data, opts || {});

    // состояние
    this._state = 'initial';
    this._lastSoundTime = 0;

    // внутреннее аудио
    this._audioCtx = null;
    this._analyser = null;
    this._source = null;
    this._timeDomain = null;
    this._buf = null;
    this._bufPos = 0;
    this._bars = 0;
    this._raf = null;
    this._timer = null;
    this._dpr = window.devicePixelRatio || 1;
    this._peakHold = 0;
    this._destroyed = false;

    this._mount();
    this._boundResize = this._onResize.bind(this);
    window.addEventListener('resize', this._boundResize, { passive: true });
    this._onResize();
  }

  async connectStream(mediaStream) {
    if (this._destroyed) return false;
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      throw new Error('MicIndicator.connectStream: invalid MediaStream');
    }
    if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (this._source) try { this._source.disconnect(); } catch (e) {}
    this._source = this._audioCtx.createMediaStreamSource(mediaStream);

    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = this.opts.fftSize;
    this._analyser.smoothingTimeConstant = this.opts.analyserSmoothing;
    this._timeDomain = new Uint8Array(this._analyser.fftSize);

    try { this._source.connect(this._analyser); } catch (e) { console.warn('connectStream:', e); }

    this._setState('initial');
    this._lastSoundTime = Date.now();

    this._startTimer();
    this._startRender();
    return true;
  }

  disconnect() {
    this._stopTimer();
    this._stopRender();
    if (this._source) try { this._source.disconnect(); } catch (e) {}
    this._source = null;
    if (this._analyser) try { this._analyser.disconnect(); } catch (e) {}
    this._analyser = null;
    this._setState('initial');
  }

  setSimLevel(v) {
    const val = Math.max(0, Math.min(1, Number(v) || 0));
    if (!this._buf) return;
    this._buf[this._bufPos] = val;
    this._bufPos = (this._bufPos + 1) % this._buf.length;
  }

  setInactive() {
    if (!this._buf) return;
    this._buf.fill(0); this._bufPos = 0;
    this._setState('initial');
    this._renderOnce();
  }

  destroy() {
    this.disconnect();
    window.removeEventListener('resize', this._boundResize);
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._destroyed = true;
  }

  // ================== внутренние ==================
  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    this._renderOnce();
  }

  _mount() {
    this._root = this.container.querySelector('.sv-mic-indicator');
    if (!this._root) {
      this._root = document.createElement('div'); this._root.className = 'sv-mic-indicator';
      this.container.appendChild(this._root);
    }
    this._wrap = this._root.querySelector('.sv-mic-indicator__wrap') || document.createElement('div');
    this._wrap.className = 'sv-mic-indicator__wrap';
    this._canvas = this._root.querySelector('.sv-mic-indicator__canvas') || document.createElement('canvas');
    this._canvas.className = 'sv-mic-indicator__canvas';
    this._ctx = this._canvas.getContext('2d', { alpha: true });
    if (!this._wrap.parentNode) this._root.appendChild(this._wrap);
    if (!this._canvas.parentNode) this._wrap.appendChild(this._canvas);
  }

  _onResize() {
    const cs = getComputedStyle(this._root);
    const padding = parseFloat(cs.getPropertyValue('--svmic-padding-px')) || 0;
    const barWidthCss = parseFloat(cs.getPropertyValue('--svmic-bar-width-px')) || this.opts.barWidthPx || 6;
    const gap = parseFloat(cs.getPropertyValue('--svmic-gap-px')) || this.opts.gapPx || 2;

    const rect = this._wrap.getBoundingClientRect();
    const totalW = Math.max(40, rect.width - padding * 2);
    let possibleBars = Math.floor((totalW + gap) / (barWidthCss + gap));
    if (possibleBars < this.opts.minBars) possibleBars = this.opts.minBars;
    this._bars = possibleBars;

    if (!this._buf || this._buf.length !== this._bars) {
      this._buf = new Float32Array(this._bars); this._buf.fill(0); this._bufPos = 0;
    }

    this._dpr = window.devicePixelRatio || 1;
    const cssRect = this._canvas.getBoundingClientRect();
    const wPx = Math.max(1, Math.floor(cssRect.width * this._dpr));
    const hPx = Math.max(1, Math.floor(cssRect.height * this._dpr));
    if (this._canvas.width !== wPx || this._canvas.height !== hPx) {
      this._canvas.width = wPx; this._canvas.height = hPx;
    }
    this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._renderOnce();
  }

  _startTimer() { if (this._timer) return; const ms = Math.max(16, this.opts.stepMs | 0); this._timer = setInterval(()=> this._step(), ms); }
  _stopTimer() { if (!this._timer) return; clearInterval(this._timer); this._timer = null; }

  _startRender() {
    if (this._raf) return;
    const loop = ()=> { this._renderOnce(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }
  _stopRender() { if (!this._raf) return; cancelAnimationFrame(this._raf); this._raf = null; }

  _step() {
    if (!this._analyser) return;
    try { this._analyser.getByteTimeDomainData(this._timeDomain); } catch(e){ return; }

    // RMS и пик
    let sum = 0, instantPeak = 0;
    for (let i=0;i<this._timeDomain.length;i++){
      const v = (this._timeDomain[i] - 128) / 128;
      sum += v*v;
      const av = Math.abs(v);
      if (av > instantPeak) instantPeak = av;
    }
    const rms = Math.sqrt(sum / this._timeDomain.length);

    // decay peak
    this._peakHold = Math.max(instantPeak, (this._peakHold || 0) * this.opts.peakDecay);

    // расчет нормализованного уровня
    const rmsPart = Math.pow(rms, this.opts.exponent) * this.opts.sensitivity;
    const peakPart = Math.min(1, instantPeak * this.opts.peakMultiplier);
    const normalized = Math.max(rmsPart, peakPart, this.opts.minVisible);

    // определение тишины / активности
    const now = Date.now();
    if (normalized > this.opts.silenceThreshold) {
      this._lastSoundTime = now;
      if (this._state !== 'working') this._setState('working');
    } else {
      const silenceDur = now - this._lastSoundTime;
      if (silenceDur > this.opts.silenceTimeoutMs && this._state === 'working') {
        this._setState('pause');
      }
    }

    if (!this._buf || this._state === 'initial' || this._state === 'pause') return;
    this._buf[this._bufPos] = normalized;
    this._bufPos = (this._bufPos + 1) % this._buf.length;
  }

  _renderOnce() {
    const ctx = this._ctx; if (!ctx) return;
    const canvasRect = this._canvas.getBoundingClientRect();
    const cssW = canvasRect.width || (this._canvas.width / this._dpr);
    const cssH = canvasRect.height || (this._canvas.height / this._dpr);

    const style = getComputedStyle(this._root);
    const baselineColor = style.getPropertyValue('--svmic-baseline-color') || '#e6e8eb';
    const barColor = style.getPropertyValue('--svmic-bar-color') || '#151515';
    const minVisible = parseFloat(style.getPropertyValue('--svmic-min-visible')) || this.opts.minVisible;
    const barWidthCss = parseFloat(style.getPropertyValue('--svmic-bar-width-px')) || this.opts.barWidthPx || 6;
    const gap = parseFloat(style.getPropertyValue('--svmic-gap-px')) || this.opts.gapPx || 2;

    // initial → рисуем baseline и выходим
    if (this._state === 'initial') {
      ctx.clearRect(0, 0, cssW, cssH);
      const center = Math.round(cssH / 2);
      ctx.fillStyle = baselineColor.trim();
      ctx.fillRect(0, center - 0.5, cssW, 1);
      return;
    }

    // pause → не перерисовываем (оставляем последний кадр)
    if (this._state === 'pause') return;

    ctx.clearRect(0, 0, cssW, cssH);
    const center = Math.round(cssH / 2);
    ctx.fillStyle = baselineColor.trim();
    ctx.fillRect(0, center - 0.5, cssW, 1);

    if (!this._buf || this._buf.length === 0) return;

    const totalBarSpace = this._bars * barWidthCss + Math.max(0, (this._bars - 1) * gap);
    const startX = Math.round(Math.max(0, (cssW - totalBarSpace) / 2));
    const maxH = Math.max(4, Math.floor((cssH / 2) - 1));

    ctx.fillStyle = barColor.trim();
    let idx = this._bufPos;
    for (let i=0;i<this._bars;i++){
      const v = this._buf[idx] || 0;
      idx = (idx + 1) % this._buf.length;
      if (v <= minVisible) continue;
      const x = startX + i * (barWidthCss + gap);
      const h = Math.round(v * maxH);
      ctx.fillRect(x, center - h, barWidthCss, h);
      ctx.fillRect(x, center, barWidthCss, h);
    }
  }
}
