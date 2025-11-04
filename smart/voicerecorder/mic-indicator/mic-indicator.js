// mic-indicator.js
// ES module. Export default class MicIndicator.
// Self-contained: draws baseline immediately; starts active rendering only after connectStream().
// NO maxBars option — component fully relies on container width for number of bars.

class MicIndicator {
  constructor(container, opts = {}) {
    if (!(container instanceof Element)) {
      throw new Error('MicIndicator: container must be a DOM Element');
    }

    // Options and defaults
    this.opts = {
      stepMs: opts.stepMs ?? 100,
      sensitivity: opts.sensitivity ?? 0.95,
      minVisible: opts.minVisible ?? 0.03,
      barWidthPx: opts.barWidthPx ?? null, // if null read from CSS var
      gapPx: opts.gapPx ?? null,
    };

    this.container = container;
    this._destroyed = false;

    // Internal state
    this._audioCtx = null;
    this._analyser = null;
    this._source = null;
    this._timeDomain = null;
    this._bars = 0;
    this._buf = null;
    this._bufPos = 0;
    this._rafId = null;
    this._timerId = null;
    this._dpr = window.devicePixelRatio || 1;

    // event callbacks
    this._events = {};

    // Build DOM
    this._mount();

    // Initial sizing and baseline render
    this._boundResize = this._onResize.bind(this);
    window.addEventListener('resize', this._boundResize, { passive: true });
    this._onResize();
  }

  // -----------------------
  // public API
  // -----------------------
  async connectStream(mediaStream) {
    if (this._destroyed) return false;
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      throw new Error('MicIndicator.connectStream: invalid MediaStream');
    }

    // create AudioContext lazily
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // disconnect any previous source
    if (this._source) {
      try { this._source.disconnect(); } catch (e) {}
      this._source = null;
    }

    // create media stream source and analyser
    this._source = this._audioCtx.createMediaStreamSource(mediaStream);
    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.2;
    this._timeDomain = new Uint8Array(this._analyser.fftSize);
    try {
      this._source.connect(this._analyser);
    } catch (e) {
      console.warn('MicIndicator: connect failed', e);
    }

    // Start periodic step and continuous render
    this._startTimer();
    this._startRender();

    this._emit('connect');
    return true;
  }

  disconnect() {
    // stop timers and disconnect audio nodes
    this._stopTimer();
    this._stopRender();
    if (this._source) {
      try { this._source.disconnect(); } catch (e) {}
      this._source = null;
    }
    if (this._analyser) {
      try { this._analyser.disconnect(); } catch (e) {}
      this._analyser = null;
    }
    this._emit('disconnect');
  }

  setSimLevel(value) {
    // external test helper: push simulated normalized level [0..1]
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    if (!this._buf) return;
    this._buf[this._bufPos] = v;
    this._bufPos = (this._bufPos + 1) % this._buf.length;
  }

  destroy() {
    this.disconnect();
    window.removeEventListener('resize', this._boundResize);
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._destroyed = true;
    this._emit('destroy');
    this._events = {};
  }

  on(name, fn) {
    (this._events[name] = this._events[name] || []).push(fn);
  }

  off(name, fn) {
    if (!this._events[name]) return;
    this._events[name] = this._events[name].filter(f => f !== fn);
  }

  // -----------------------
  // internals
  // -----------------------
  _emit(name, ...args) {
    const list = this._events[name];
    if (!list || !list.length) return;
    for (const fn of list.slice()) try { fn(...args); } catch (e) {}
  }

  _mount() {
    // root wrapper (only one appended)
    this._root = document.createElement('div');
    this._root.className = 'sv-mic-indicator';

    this._wrap = document.createElement('div');
    this._wrap.className = 'sv-mic-indicator__wrap';

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'sv-mic-indicator__canvas';

    this._ctx = this._canvas.getContext('2d', { alpha: true });

    this._wrap.appendChild(this._canvas);
    this._root.appendChild(this._wrap);
    this.container.appendChild(this._root);
  }

  _onResize() {
    // compute sizes & bars
    const cs = getComputedStyle(this._root);
    const padding = parseFloat(cs.getPropertyValue('--svmic-padding-px')) || 8;
    const barWidthCss = parseFloat(cs.getPropertyValue('--svmic-bar-width-px')) || this.opts.barWidthPx || 6;
    const gap = parseFloat(cs.getPropertyValue('--svmic-gap-px')) || this.opts.gapPx || 2;

    const rect = this._wrap.getBoundingClientRect();
    const totalW = Math.max(40, rect.width - padding * 2);

    let possibleBars = Math.floor((totalW + gap) / (barWidthCss + gap));
    if (possibleBars < 4) possibleBars = 4;

    // NOTE: No maxBars cap — we rely entirely on container width and CSS to control visual length.
    this._bars = possibleBars;

    // prepare circular buffer
    if (!this._buf || this._buf.length !== this._bars) {
      this._buf = new Float32Array(this._bars);
      for (let i=0;i<this._buf.length;i++) this._buf[i] = 0;
      this._bufPos = 0;
    }

    // setup HiDPI canvas size
    this._dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    this._canvas.style.width = cssW + 'px';
    this._canvas.style.height = cssH + 'px';
    const wPx = Math.max(1, Math.floor(cssW * this._dpr));
    const hPx = Math.max(1, Math.floor(cssH * this._dpr));
    if (this._canvas.width !== wPx || this._canvas.height !== hPx) {
      this._canvas.width = wPx;
      this._canvas.height = hPx;
    }
    this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    // draw baseline immediately so widget is visible in "off" state
    this._renderOnce();
  }

  _startTimer() {
    if (this._timerId) return;
    this._timerId = setInterval(() => this._step(), this.opts.stepMs);
  }

  _stopTimer() {
    if (!this._timerId) return;
    clearInterval(this._timerId);
    this._timerId = null;
  }

  _startRender() {
    if (this._rafId) return;
    const loop = () => {
      this._renderOnce();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopRender() {
    if (!this._rafId) return;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _step() {
    // read analyser and push a representative normalized value into buffer
    if (!this._analyser) return;
    try {
      this._analyser.getByteTimeDomainData(this._timeDomain);
    } catch (e) {
      return;
    }
    // compute RMS normalized to [0..1]
    let sum = 0;
    for (let i = 0; i < this._timeDomain.length; i++) {
      const v = (this._timeDomain[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._timeDomain.length); // 0..~1
    // apply sensitivity curve
    const normalized = Math.max(0, Math.min(1, Math.pow(rms, 0.75) * this.opts.sensitivity));
    // push to circular buffer
    if (!this._buf) return;
    this._buf[this._bufPos] = normalized;
    this._bufPos = (this._bufPos + 1) % this._buf.length;
  }

  _renderOnce() {
    const ctx = this._ctx;
    if (!ctx) return;
    const style = getComputedStyle(this._root);
    const baselineColor = style.getPropertyValue('--svmic-baseline-color') || '#e6e8eb';
    const barColor = style.getPropertyValue('--svmic-bar-color') || '#151515';
    const minVisible = parseFloat(style.getPropertyValue('--svmic-min-visible')) || this.opts.minVisible;
    const padding = parseFloat(style.getPropertyValue('--svmic-padding-px')) || 8;
    const barWidthCss = parseFloat(style.getPropertyValue('--svmic-bar-width-px')) || this.opts.barWidthPx || 6;
    const gap = parseFloat(style.getPropertyValue('--svmic-gap-px')) || this.opts.gapPx || 2;

    const cssW = parseFloat(this._canvas.style.width) || this._canvas.width / this._dpr;
    const cssH = parseFloat(this._canvas.style.height) || this._canvas.height / this._dpr;

    ctx.clearRect(0, 0, cssW, cssH);

    // baseline
    const center = Math.round(cssH / 2);
    ctx.fillStyle = baselineColor.trim();
    ctx.globalAlpha = 1;
    ctx.fillRect(0, center - 0.5, cssW, 1);

    // draw bars (centered)
    if (!this._buf || this._buf.length === 0) return;
    const totalBarSpace = this._bars * barWidthCss + Math.max(0, (this._bars - 1) * gap);
    const startX = Math.round(Math.max(0, (cssW - totalBarSpace) / 2));
    const maxH = Math.max(4, Math.floor((cssH / 2) - 2));

    ctx.fillStyle = barColor.trim();
    ctx.globalAlpha = 1;
    // iterate buffer oldest-first
    let idx = this._bufPos;
    for (let i = 0; i < this._bars; i++) {
      const v = this._buf[idx] || 0;
      idx = (idx + 1) % this._buf.length;
      if (v <= minVisible) continue;
      const x = startX + i * (barWidthCss + gap);
      const h = Math.round(v * maxH);
      // top and bottom mirror
      ctx.fillRect(x, center - h, barWidthCss, h);
      ctx.fillRect(x, center, barWidthCss, h);
    }
  }
}

export default MicIndicator;
