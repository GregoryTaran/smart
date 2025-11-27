// === MicIndicator (final synced version) ===

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
  barWidthPx: null,
  gapPx: null,
};

export default class MicIndicator {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = Object.assign({}, DEFAULTS, opts);

    this._state = "initial";
    this._frozen = false;

    this._audioCtx = null;
    this._source = null;
    this._analyser = null;
    this._timeDomain = null;

    this._buf = null;
    this._bufPos = 0;

    this._timer = null;
    this._raf = null;

    this._mount();

    requestAnimationFrame(() => {
      this._boundResize = () => this._onResize();
      window.addEventListener("resize", this._boundResize);
      this._onResize();
      this._renderOnce();
    });
  }

  baselineOnly() {
    this._stopTimer();
    this._stopRender();

    if (this._buf) this._buf.fill(0);

    this._state = "initial";
    this._renderOnce();
  }

  freeze() {
    this._frozen = true;
    this._stopTimer();
    this._stopRender();
  }

  unfreeze() {
    this._frozen = false;
    this._startTimer();
    this._startRender();
  }

  async connectStream(mediaStream) {
    if (!mediaStream) return false;

    if (!this._audioCtx)
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (this._source) try { this._source.disconnect(); } catch {}
    this._source = this._audioCtx.createMediaStreamSource(mediaStream);

    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = this.opts.fftSize;
    this._analyser.smoothingTimeConstant = this.opts.analyserSmoothing;
    this._timeDomain = new Uint8Array(this._analyser.fftSize);

    try { this._source.connect(this._analyser); } catch {}

    this._state = "working";

    if (!this._frozen) {
      this._startTimer();
      this._startRender();
    }

    return true;
  }

  // --- DOM ---
  _mount() {
    this._root = document.createElement("div");
    this._root.className = "sv-mic-indicator";

    this._wrap = document.createElement("div");
    this._wrap.className = "sv-mic-indicator__wrap";

    this._canvas = document.createElement("canvas");
    this._canvas.className = "sv-mic-indicator__canvas";

    this._ctx = this._canvas.getContext("2d");

    this.container.appendChild(this._root);
    this._root.appendChild(this._wrap);
    this._wrap.appendChild(this._canvas);
  }

  _onResize() {
    const rect = this._wrap.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const dpr = window.devicePixelRatio || 1;

    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;
    this._canvas.style.width = width + "px";
    this._canvas.style.height = height + "px";

    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const barWidth = this.opts.barWidthPx || 3;
    const gap = this.opts.gapPx || 2;

    const bars = Math.floor(width / (barWidth + gap));
    this._bars = Math.max(this.opts.minBars, bars);

    if (!this._buf || this._buf.length !== this._bars) {
      this._buf = new Float32Array(this._bars);
      this._buf.fill(0);
      this._bufPos = 0;
    }

    this._renderOnce();
  }

  _startTimer() {
    if (this._timer) return;
    this._timer = setInterval(() => this._step(), this.opts.stepMs);
  }

  _stopTimer() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  _startRender() {
    if (this._raf) return;
    const loop = () => {
      if (!this._frozen) this._renderOnce();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopRender() {
    if (!this._raf) return;
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _step() {
    if (!this._analyser || this._state !== "working" || this._frozen) return;

    this._analyser.getByteTimeDomainData(this._timeDomain);

    let sum = 0;
    for (let i = 0; i < this._timeDomain.length; i++) {
      const v = (this._timeDomain[i] - 128) / 128;
      sum += v * v;
    }

    const rms = Math.sqrt(sum / this._timeDomain.length);
    const level = Math.pow(rms, this.opts.exponent) * this.opts.sensitivity;

    this._buf[this._bufPos] = Math.max(level, this.opts.minVisible);
    this._bufPos = (this._bufPos + 1) % this._buf.length;
  }

  _drawBaseline(ctx, w, h) {
    const y = Math.round(h / 2);
    ctx.fillStyle = "#e6e8eb";

    for (let x = 0; x < w; x += 8) {
      ctx.fillRect(x, y, 4, 1);
    }
  }

  _renderOnce() {
    const ctx = this._ctx;
    const dpr = window.devicePixelRatio || 1;

    const w = this._canvas.width / dpr;
    const h = this._canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);

    this._drawBaseline(ctx, w, h);

    if (this._state === "initial") return;

    const barWidth = this.opts.barWidthPx || 3;
    const gap = this.opts.gapPx || 2;
    const center = Math.round(h / 2);
    const maxH = Math.floor(h / 2 - 2);

    ctx.fillStyle = "#151515";

    let idx = this._bufPos;

    for (let i = 0; i < this._bars; i++) {
      const v = this._buf[idx];
      idx = (idx + 1) % this._buf.length;

      if (v <= this.opts.minVisible) continue;

      const x = i * (barWidth + gap);
      const hh = Math.round(v * maxH);

      ctx.fillRect(x, center - hh, barWidth, hh);
      ctx.fillRect(x, center, barWidth, hh);
    }
  }
}
