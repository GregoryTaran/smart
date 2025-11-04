// mic-indicator.js
// Простая, надёжная реализация индикатора уровня звука.
// Поддерживаем API:
// new MicIndicator(root, { sensitivity: 0.9, stepMs: 90 })
// .connectStream(mediaStream)  // если нужно локально слушать микрофон
// .disconnect()                // отключить локальный прослушиватель
// .setLevel(rms)               // задать уровень (0..1) внешне (например из worklet)
// .setSimLevel(x)              // alias для setLevel
// .setInactive()               // вернуть «выключенный» baseline

export default class MicIndicator {
  constructor(rootEl, opts = {}) {
    if (!rootEl) throw new Error('MicIndicator: root element required');
    this.root = rootEl;
    this.opts = Object.assign({
      sensitivity: 0.9, // 0..1 (default 0.9 == 90%)
      stepMs: 90,       // polling / render step in ms
      smoothing: 0.6,   // 0..1, larger == smoother/slower
      decay: 0.05       // how fast level falls each step
    }, opts);

    // internal state
    this._level = 0;           // displayed level 0..1
    this._target = 0;          // target level to approach
    this._raf = null;
    this._timer = null;

    // audio internals when connectStream used
    this._audioCtx = null;
    this._analyser = null;
    this._source = null;
    this._mediaStream = null;

    // render structure
    this._createDOM();
    this.setInactive();
    this._startRenderLoop();
  }

  // create minimal DOM inside root to avoid CSS dependencies
  _createDOM() {
    this.root.classList.add('sv-mic-indicator-root');
    // main visual bar (horizontal)
    let barWrap = document.createElement('div');
    barWrap.className = 'sv-mi-barwrap';
    barWrap.style.position = 'relative';
    barWrap.style.width = '100%';
    barWrap.style.height = '100%';
    barWrap.style.display = 'flex';
    barWrap.style.alignItems = 'center';
    barWrap.style.justifyContent = 'center';
    barWrap.style.overflow = 'hidden';

    const bar = document.createElement('div');
    bar.className = 'sv-mi-bar';
    bar.style.width = '0%';
    bar.style.height = '12px';
    bar.style.borderRadius = '6px';
    bar.style.transition = 'width 80ms linear';
    bar.style.background = 'linear-gradient(90deg,#4caf50,#8bc34a)';
    barWrap.appendChild(bar);

    // baseline thin white/gray center line handled by page css (we don't duplicate)
    this._bar = bar;
    this.root.appendChild(barWrap);
  }

  // internal render loop (smooth transition of display towards target)
  _startRenderLoop() {
    const step = () => {
      // exponential smoothing towards target
      const s = this.opts.smoothing;
      this._level = this._level * s + this._target * (1 - s);

      // small decay if target is zero so it doesn't stick
      this._level = Math.max(0, this._level - this.opts.decay);

      // clamp and apply to DOM
      const pct = Math.max(0, Math.min(1, this._level));
      this._bar.style.width = Math.round(pct * 100) + '%';

      this._raf = requestAnimationFrame(step);
    };
    if (!this._raf) this._raf = requestAnimationFrame(step);
  }

  _stopRenderLoop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  // map raw RMS (0..1) -> displayed target (0..1) using sensitivity
  _mapRmsToTarget(rms) {
    // apply basic gain according to sensitivity.
    // sensitivity in [0..1]. We map to gain in [1 .. 10]
    const gain = 1 + (this.opts.sensitivity * 9); // sensitivity 0.9 => gain ~9.1
    let val = rms * gain;

    // apply soft compression to avoid saturation: out = 1 - exp(-k*x)
    const k = 2.2;
    val = 1 - Math.exp(-k * val);

    // clamp
    return Math.max(0, Math.min(1, val));
  }

  // external API: set level from external source (worklet etc.)
  setLevel(rms) {
    if (typeof rms !== 'number' || !isFinite(rms)) return;
    // rms expected in 0..1 (if >1 we clamp)
    const norm = Math.max(0, Math.min(1, rms));
    this._target = this._mapRmsToTarget(norm);
  }
  setSimLevel(v) { return this.setLevel(v); }
  pushLevel(v) { return this.setLevel(v); }

  // set visual to inactive baseline (thin white/low)
  setInactive() {
    this._target = 0;
    this._level = 0;
    if (this._bar) this._bar.style.width = '0%';
  }

  // connect directly to a MediaStream (useful for quick local testing)
  async connectStream(stream) {
    if (!stream) return;
    try {
      // if already connected, disconnect first
      if (this._mediaStream) this.disconnect();

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new AudioCtx();
      this._mediaStream = stream;
      this._source = this._audioCtx.createMediaStreamSource(stream);

      // create analyser with small fftSize for RMS calculation
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 1024;
      this._analyser.smoothingTimeConstant = 0.3;
      this._source.connect(this._analyser);

      // start polling at configured stepMs
      const buf = new Float32Array(this._analyser.fftSize);
      const poll = () => {
        if (!this._analyser) return;
        try {
          this._analyser.getFloatTimeDomainData(buf);
        } catch(e) { return; }
        // calc rms
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const x = buf[i];
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length); // typically 0..~0.5 for normal speech
        // normalize approximate rms to 0..1 by applying small gain constant
        // (we expect speech RMS in ~0..0.2 range; mapping done in _mapRmsToTarget)
        const normalized = Math.max(0, Math.min(1, rms * 2.0));
        this.setLevel(normalized);
      };

      // first immediate poll then interval
      poll();
      this._timer = setInterval(poll, Math.max(16, this.opts.stepMs | 0));
    } catch (e) {
      console.warn('MicIndicator.connectStream error', e);
    }
  }

  // disconnect local audio processing
  disconnect() {
    try {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._analyser) { try { this._analyser.disconnect(); } catch(e){} this._analyser = null; }
      if (this._source) { try { this._source.disconnect(); } catch(e){} this._source = null; }
      if (this._audioCtx) { try { this._audioCtx.close(); } catch(e){} this._audioCtx = null; }
      this._mediaStream = null;
      this.setInactive();
    } catch (e) {
      console.debug('MicIndicator.disconnect error', e);
    }
  }

  // cleanup
  destroy() {
    this.disconnect();
    this._stopRenderLoop();
    try { if (this.root && this._bar) this.root.removeChild(this._bar.parentElement); } catch(e){}
  }
}
