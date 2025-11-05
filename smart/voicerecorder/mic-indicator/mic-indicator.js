// mic-indicator.js
// Minimal, self-contained MicIndicator implementation compatible with voicerecorder.js usage.

// --- defaults (must be declared BEFORE class usage) ---
const DEFAULTS = {
  stepMs: 100,
  fftSize: 256,
  analyserSmoothing: 0.2,
  sensitivity: 7,
  exponent: 0.95,
  minVisible: 0.01,
  minBars: 6,
  peakMultiplier: 7,
  peakDecay: 0.98,
  bufDecay: 1,
  barWidthPx: null,
  gapPx: null,
  silenceTimeoutMs: 800 // when to consider "pause" after last sound
};

// --- MicIndicator class ---
export default class MicIndicator {
  static setDefaults(o = {}) { Object.assign(DEFAULTS, o); }

  constructor(container, opts = {}) {
    if (!(container instanceof Element)) throw new Error('MicIndicator: container must be a DOM Element');
    this._container = container;
    this.container = container; // backward alias

    // read data- attributes if present
    const d = this._container.dataset || {};
    const data = {};
    if (d.stepMs) data.stepMs = Number(d.stepMs);
    if (d.sensitivity) data.sensitivity = Number(d.sensitivity);
    if (d.fftSize) data.fftSize = Number(d.fftSize);

    this.opts = Object.assign({}, DEFAULTS, data, opts || {});

    // internal state
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

    this._state = 'initial'; // initial | working | pause
    this._latestRms = 0;
    this._lastSoundTs = 0;

    // mount canvas, listeners
    this._mount();
    this._boundResize = this._onResize.bind(this);
    window.addEventListener('resize', this._boundResize, { passive: true });
    // initial sizing
    this._onResize();
  }

  /* ------------------ Public API expected by voicerecorder.js ------------------ */

  // connect MediaStream (host provides stream)
  async connectStream(mediaStream) {
    if (this._destroyed) return false;
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      throw new Error('MicIndicator.connectStream: invalid MediaStream');
    }
    if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (this._source) try { this._source.disconnect(); } catch (e) {}
    this._source = this._audioCtx.createMediaStreamSource(mediaStream);

    // create analyser
    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = this.opts.fftSize || DEFAULTS.fftSize;
    this._analyser.smoothingTimeConstant = this.opts.analyserSmoothing ?? DEFAULTS.analyserSmoothing;
    this._timeDomain = new Uint8Array(this._analyser.fftSize);

    try { this._source.connect(this._analyser); } catch (e) { console.warn('connectStream:', e); }

    this._startTimer();
    this._startRender();
    return true;
  }

  // disconnect MediaStream and stop rendering/timers
  disconnect() {
    this._stopTimer();
    this._stopRender();
    if (this._source) try { this._source.disconnect(); } catch (e) {}
    this._source = null;
    if (this._analyser) try { this._analyser.disconnect(); } catch (e) {}
    this._analyser = null;
    this._audioCtx = null;
    // keep canvas visible (pause state)
    this._state = 'initial';
    this._clearCanvas();
  }

  // optional: host may pass an AudioNode (we'll attach analyser to it)
  connectAudioNode(node) {
    if (!node || !node.context) throw new Error('connectAudioNode: ожидается AudioNode с контекстом');
    this._audioCtx = node.context;  // Use provided context
    if (this._analyser) try { this._analyser.disconnect(); } catch (e) {}
    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = this.opts.fftSize || DEFAULTS.fftSize;
    node.connect(this._analyser);
    this._timeDomain = new Uint8Array(this._analyser.fftSize);
    this._startTimer();
    this._startRender();
  }

  // receive a numeric level from external source (0..1)
  setLevel(rms) {
    const v = Number(rms) || 0;
    this._latestRms = Math.max(0, Math.min(1, v));
    this._onAudioLevel(this._latestRms);
  }
  setSimLevel(rms) { this.setLevel(rms); }
  pushLevel(rms) { this.setLevel(rms); }

  // set module to inactive / initial visual state
  setInactive() {
    this._state = 'initial';
    this._stopTimer();
    this._stopRender();
    this._clearCanvas();
  }

  /* ------------------ Internal rendering / sampling ------------------ */

  _mount() {
    // create a canvas inside container
    this._canvas = document.createElement('canvas');
    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';
    this._canvas.style.display = 'block';
    this._canvas.style.pointerEvents = 'none';
    // ensure container has at least minimal height via CSS from host or mic CSS
    this._container.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
  }

  _clearCanvas() {
    if (!this._ctx) return;
    const w = this._canvas.width;
    const h = this._canvas.height;
    this._ctx.clearRect(0, 0, w, h);
  }

  _onResize() {
    try {
      const rect = this._container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * this._dpr));
      const h = Math.max(1, Math.floor(rect.height * this._dpr));
      this._canvas.width = w;
      this._canvas.height = h;
      this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0); // handle DPR
      // redraw last frame
      this._draw();
    } catch (e) {
      // ignore
    }
  }

  // timer: sample analyser at interval and update _latestRms
  _startTimer() {
    this._stopTimer();
    if (!this._analyser) return;
    const step = Math.max(20, Number(this.opts.stepMs) || DEFAULTS.stepMs);
    this._timer = setInterval(() => {
      try {
        if (!this._analyser) return;
        this._analyser.getByteTimeDomainData(this._timeDomain);
        // compute RMS from time-domain bytes (0..255 -> center 128)
        let sum = 0;
        for (let i = 0; i < this._timeDomain.length; i++) {
          const v = (this._timeDomain[i] - 128) / 128; // -1..1
          sum += v * v;
        }
        const rms = Math.sqrt(sum / this._timeDomain.length); // 0..1
        // apply sensitivity/exponent if desired
        const scaled = Math.pow(Math.min(1, rms * (this.opts.sensitivity || 7)), this.opts.exponent || 1);
        this._latestRms = scaled;
        if (scaled > 0.001) this._lastSoundTs = performance.now();
        this._onAudioLevel(scaled);
      } catch (e) {
        // ignore sampling errors
      }
    }, step);
  }
  _stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // rendering loop (RAF)
  _startRendering() { this._rendering = true; this._renderFrame(); }
  _stopRendering() { this._rendering = false; if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } }

  // aliases used in older code
  _startRender() { return this._startRendering(); }
  _stopRender() { return this._stopRendering(); }

  _renderFrame() {
    try {
      this._draw();
    } catch (e) { /* ignore drawing errors */ }
    if (this._rendering) {
      this._raf = requestAnimationFrame(this._renderFrame.bind(this));
    }
  }

  // basic draw implementation: fill background by state and draw level bar
  _draw() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const w = this._canvas.width / this._dpr;
    const h = this._canvas.height / this._dpr;

    // clear
    ctx.clearRect(0, 0, w, h);

    // draw background by state
    if (this._state === 'working') {
      // greenish faded background
      ctx.fillStyle = 'rgba(39, 174, 96, 0.06)';
      ctx.fillRect(0, 0, w, h);
    } else if (this._state === 'pause') {
      ctx.fillStyle = 'rgba(120,120,120,0.04)';
      ctx.fillRect(0, 0, w, h);
    }

    // draw level bar
    const level = Math.max(0, Math.min(1, this._latestRms || 0));
    const barW = Math.max(4, Math.floor(w * 0.06));
    const gap = Math.max(2, Math.floor(barW * 0.3));
    const barCount = Math.max(1, Math.floor((w + gap) / (barW + gap)));
    const maxBarH = h * 0.85;
    const baseY = h - 4;

    // compute number of bars to light based on level
    const lit = Math.round(level * barCount);

    for (let i = 0; i < barCount; i++) {
      const x = i * (barW + gap);
      const isLit = i < lit;
      if (isLit) {
        // color grad
        const g = Math.round(180 + (75 * (i / Math.max(1, barCount))));
        ctx.fillStyle = `rgb(${g}, ${200}, ${80})`;
        const hBar = Math.round(maxBarH * ((i + 1) / barCount));
        ctx.fillRect(x, baseY - hBar, barW, hBar);
      } else {
        ctx.fillStyle = 'rgba(200,200,200,0.06)';
        ctx.fillRect(x, baseY - (maxBarH * 0.18), barW, Math.max(2, Math.floor(maxBarH * 0.18)));
      }
    }

    // draw peak indicator (simple)
    if (this._latestRms > 0.001) {
      this._peakHold = Math.max(this._peakHold * (this.opts.peakDecay || 0.98), this._latestRms);
    } else {
      this._peakHold *= (this.opts.peakDecay || 0.98);
    }
  }

  // handle audio level transitions
  _onAudioLevel(level) {
    const now = performance.now();
    if (level > (this.opts.minVisible || 0.01)) {
      if (this._state !== 'working') {
        this._state = 'working';
        this._startRender();
      }
      this._lastSoundTs = now;
    } else {
      if (this._lastSoundTs && (now - this._lastSoundTs) > (this.opts.silenceTimeoutMs || 800)) {
        if (this._state !== 'pause') {
          this._state = 'pause';
          // keep last frame visible (do not clear), stop sampling but keep render for pause shading
          this._stopTimer();
        }
      }
    }
  }

  // cleanup
  destroy() {
    this._destroyed = true;
    this.disconnect();
    window.removeEventListener('resize', this._boundResize);
    try { if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas); } catch (e) {}
    this._ctx = null;
  }
}
