// mic-indicator.js
// ESM class MicIndicator — lightweight, no external deps.
// - Create with a container element (DOM node).
// - Call connectMic() to request microphone (user gesture required), or
//   call connectStream(mediaStream) to reuse an existing MediaStream.
// - Methods: connectMic(), connectStream(stream), disconnect(), destroy(),
//   setSensitivity(v), setStepMs(ms), setBarWidthMm(mm), setSimLevel(v).
// - Defaults: stepMs = 100, sensitivity = 0.9, barWidthMm = 0.85, gapPx = 2.

class MicIndicator {
  constructor(container, opts = {}) {
    if (!(container instanceof Element)) {
      throw new Error('MicIndicator: container must be a DOM Element');
    }
    // options with sane defaults
    this.stepMs = opts.stepMs ?? 100;
    this.sensitivity = opts.sensitivity ?? 0.9;
    this.barWidthMm = opts.barWidthMm ?? 0.85;
    this.gapPx = opts.gapPx ?? 2;
    this.minVisible = opts.minVisible ?? 0.03; // below this only baseline is shown

    // internal
    this.container = container;
    this._audioCtx = null;
    this._analyser = null;
    this._source = null;
    this._timeDomain = null;
    this._buf = null;
    this._bufPos = 0;
    this._barsVisible = 0;
    this._mmPx = this._computeMmToPx();
    this._dpr = window.devicePixelRatio || 1;
    this._rafId = null;
    this._stepTimer = null;
    this._destroyed = false;
    this._env = 0;

    // event handlers map
    this._events = Object.create(null);

    // build DOM
    this._mountDOM();

    // initial resize/setup
    this._resize();
    // keep resize listener debounced
    this._resizeObserver = new ResizeObserver(() => this._debouncedResize());
    this._resizeObserver.observe(this.container);
    this._debounceResizeTimer = null;
  }

  // ------------- public API -------------
  // request microphone (calls getUserMedia)
  async connectMic(constraints = { audio: true }) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.connectStream(stream);
  }

  // use an existing MediaStream (no extra permissions)
  async connectStream(stream) {
    if (this._destroyed) return;
    if (!(stream && stream.getAudioTracks && stream.getAudioTracks().length)) {
      throw new Error('MicIndicator.connectStream: invalid MediaStream');
    }

    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // create source & analyser
    try {
      if (this._source) {
        try { this._source.disconnect(); } catch(e) {}
      }
      this._source = this._audioCtx.createMediaStreamSource(stream);
    } catch (err) {
      this._emit('error', err);
      console.warn('MicIndicator: createMediaStreamSource failed', err);
      return;
    }

    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.2;
    this._timeDomain = new Uint8Array(this._analyser.fftSize);

    try {
      this._source.connect(this._analyser);
    } catch(e) {
      console.warn('MicIndicator: source.connect(analyser) failed', e);
    }

    // resume audio context if suspended (user gesture may be required; caller should call from user action)
    if (this._audioCtx.state === 'suspended') {
      try { await this._audioCtx.resume(); } catch(e) { /* ignore */ }
    }

    // start step timer and render loop
    this._startStepTimer();
    this._startRender();

    this._emit('connect');
    return true;
  }

  // stop visualizing but do not destroy DOM; keeps baseline visible
  disconnect() {
    this._stopStepTimer();
    this._stopRender();
    if (this._source) {
      try { this._source.disconnect(); } catch(e) {}
      this._source = null;
    }
    if (this._analyser) {
      try { this._analyser.disconnect(); } catch(e) {}
      this._analyser = null;
    }
    // do NOT close audioContext by default (so other modules can reuse), but allow destroy() to close
    this._emit('disconnect');
  }

  // full cleanup: stop timers, remove DOM, close audio context
  destroy() {
    this.disconnect();
    if (this._audioCtx && typeof this._audioCtx.close === 'function') {
      try { this._audioCtx.close(); } catch(e) {}
    }
    this._audioCtx = null;
    this._destroyed = true;
    // remove DOM nodes we created
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch(e) {}
      this._resizeObserver = null;
    }
    if (this._rootEl && this._rootEl.parentNode === this.container) {
      this.container.removeChild(this._rootEl);
    }
    this._emit('destroy');
    this._events = Object.create(null);
  }

  // manual controls
  setSensitivity(v) { this.sensitivity = Number(v) || this.sensitivity; }
  setStepMs(ms) {
    this.stepMs = Math.max(10, Number(ms) || this.stepMs);
    if (this._stepTimer) {
      this._stopStepTimer();
      this._startStepTimer();
    }
  }
  setBarWidthMm(mm) {
    this.barWidthMm = Number(mm) || this.barWidthMm;
    this._mmPx = this._computeMmToPx();
    this._resize(); // recompute bars
  }

  // send a synthetic/test level (0..1) — handy for testing without mic
  setSimLevel(v) {
    const val = Math.max(0, Math.min(1, v));
    if (!this._buf) return;
    this._push(val);
  }

  // subscribe/unsubscribe events: 'connect','disconnect','level','error','destroy'
  on(evt, cb) {
    if (!this._events[evt]) this._events[evt] = [];
    this._events[evt].push(cb);
    return () => this.off(evt, cb);
  }
  off(evt, cb) {
    if (!this._events[evt]) return;
    const idx = this._events[evt].indexOf(cb);
    if (idx >= 0) this._events[evt].splice(idx, 1);
  }
  _emit(evt, payload) {
    if (!this._events[evt]) return;
    for (const fn of this._events[evt].slice()) {
      try { fn(payload); } catch(e) { console.warn('MicIndicator event handler error', e); }
    }
  }

  // ---------------- internals ----------------
  _mountDOM() {
    // create root wrapper only if not already present
    this._rootEl = document.createElement('div');
    this._rootEl.className = 'sv-mic-indicator';
    // inner wrap for padding/background
    const wrap = document.createElement('div');
    wrap.className = 'sv-mic-indicator__wrap';
    // canvas
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'sv-mic-indicator__canvas';
    wrap.appendChild(this._canvas);
    this._rootEl.appendChild(wrap);

    // append to container (container should be prepared by integrator)
    this.container.appendChild(this._rootEl);

    // set canvas CSS width/height from computed style
    this._ctx = this._canvas.getContext('2d', { alpha: true });
  }

  _computeMmToPx() {
    const el = document.createElement('div');
    el.style.width = '1mm';
    el.style.position = 'absolute';
    el.style.left = '-100%';
    document.body.appendChild(el);
    const px = parseFloat(getComputedStyle(el).width) || 3.78;
    document.body.removeChild(el);
    return px;
  }

  // debounce resize briefly
  _debouncedResize() {
    if (this._debounceResizeTimer) clearTimeout(this._debounceResizeTimer);
    this._debounceResizeTimer = setTimeout(() => {
      this._resize();
      this._debounceResizeTimer = null;
    }, 80);
  }

  _resize() {
    if (!this._canvas) return;
    // read CSS variables from root of our component to compute sizes
    const style = getComputedStyle(this._rootEl);
    // read unique CSS vars; fall back to constructor values
    const gapCss = style.getPropertyValue('--svmic-gap-px').trim();
    const padCss = style.getPropertyValue('--svmic-padding-px').trim();
    const barWidthCss = style.getPropertyValue('--svmic-bar-width-mm').trim();
    const heightCss = style.getPropertyValue('--svmic-height').trim();

    if (gapCss) try { this.gapPx = parseFloat(gapCss); } catch(e){}
    if (barWidthCss && barWidthCss.endsWith('mm')) {
      try { this.barWidthMm = parseFloat(barWidthCss); this._mmPx = this._computeMmToPx(); } catch(e){}
    }
    if (padCss) {
      // not used in js directly, but container CSS already applies padding
    }

    // use parent container's client size (wrap)
    const wrap = this._rootEl.querySelector('.sv-mic-indicator__wrap');
    const rect = wrap.getBoundingClientRect();
    this.cssW = Math.max(40, rect.width);
    this.cssH = Math.max(20, rect.height);

    // HiDPI handling
    this._dpr = window.devicePixelRatio || 1;
    const wPx = Math.floor(this.cssW * this._dpr);
    const hPx = Math.floor(this.cssH * this._dpr);
    if (this._canvas.width !== wPx || this._canvas.height !== hPx) {
      this._canvas.width = wPx;
      this._canvas.height = hPx;
      // map back to CSS pixels
      this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }

    // compute bar width in CSS px
    this.barWidthPx = Math.max(1, Math.round(this.barWidthMm * this._mmPx));
    this._usableW = Math.max(40, this.cssW - (parseFloat(padCss) || 10) * 2);
    this._barsVisible = Math.floor((this._usableW + this.gapPx) / (this.barWidthPx + this.gapPx));
    if (this._barsVisible < 4) this._barsVisible = 4;

    // prepare buffer
    if (!this._buf || this._buf.length !== this._barsVisible) {
      this._buf = new Float32Array(this._barsVisible);
      for (let i=0;i<this._buf.length;i++) this._buf[i] = 0;
      this._bufPos = 0;
    }
  }

  // push value into circular buffer
  _push(val) {
    if (!this._buf) return;
    this._buf[this._bufPos] = val;
    this._bufPos = (this._bufPos + 1) % this._buf.length;
    this._emit('level', val);
  }

  // sample RMS and return smoothed level (0..1)
  _sampleLevel() {
    if (!this._analyser || !this._timeDomain) return 0;
    this._analyser.getByteTimeDomainData(this._timeDomain);
    let sum=0;
    for (let i=0;i<this._timeDomain.length;i++){
      const v = (this._timeDomain[i] - 128) / 128;
      sum += v*v;
    }
    const rms = Math.sqrt(sum / this._timeDomain.length);
    let level = rms * 3.0 * this.sensitivity;
    if (level > 1) level = 1;
    // simple envelope smoothing
    this._env = this._env * 0.7 + level * 0.3;
    return this._env;
  }

  _startStepTimer() {
    if (this._stepTimer) return;
    const stepFn = () => {
      let lvl = 0;
      if (this._analyser) lvl = this._sampleLevel();
      this._push(lvl);
    };
    stepFn(); // immediate
    this._stepTimer = setInterval(stepFn, this.stepMs);
  }
  _stopStepTimer() {
    if (this._stepTimer) { clearInterval(this._stepTimer); this._stepTimer = null; }
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
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _renderOnce() {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.clearRect(0,0,w,h);

    // read CSS colors (unique vars)
    const style = getComputedStyle(this._rootEl);
    const baselineColor = style.getPropertyValue('--svmic-baseline-color').trim() || '#e6e8eb';
    const barColor = style.getPropertyValue('--svmic-bar-color').trim() || '#000';

    const center = Math.round(h/2);
    const maxH = Math.max(4, (h/2) - 2);

    // baseline
    ctx.fillStyle = baselineColor;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, center - 0.5, w, 1);

    // bars (mirrored, touching center). compute startX
    const totalBarSpace = this._barsVisible * this.barWidthPx + Math.max(0, (this._barsVisible - 1) * this.gapPx);
    const startX = Math.round(((this._usableW - totalBarSpace) / 2) + (parseFloat(style.getPropertyValue('--svmic-padding-px')) || 10));

    let idx = this._bufPos;
    ctx.fillStyle = barColor;
    ctx.shadowBlur = 3;
    ctx.shadowColor = 'rgba(0,0,0,0.06)';
    for (let i=0;i<this._barsVisible;i++){
      const val = this._buf[idx] || 0;
      idx = (idx + 1) % this._buf.length;
      // skip tiny values so baseline remains visible
      if (val <= this.minVisible) continue;
      const x = startX + i * (this.barWidthPx + this.gapPx);
      const barH = Math.round(val * maxH);
      if (barH <= 0) continue;
      // draw top (touch center)
      ctx.globalAlpha = 1;
      ctx.fillRect(x, center - barH, this.barWidthPx, barH);
      // draw bottom (start at center)
      ctx.fillRect(x, center, this.barWidthPx, barH);
    }
  }
}

// default export
export default MicIndicator;
