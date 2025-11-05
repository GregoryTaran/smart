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

    this._state = 'initial'; // состояние по умолчанию
    this._mount();
    this._boundResize = this._onResize.bind(this);
    window.addEventListener('resize', this._boundResize, { passive: true });
    this._onResize();
  }

  // Подключение аудио потока от хоста
  async connectStream(mediaStream) {
    if (this._destroyed) return false;
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      throw new Error('MicIndicator.connectStream: invalid MediaStream');
    }
    if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (this._source) try { this._source.disconnect(); } catch (e) {}
    this._source = this._audioCtx.createMediaStreamSource(mediaStream);

    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = this.opts.fftSize || DEFAULTS.fftSize;
    this._analyser.smoothingTimeConstant = this.opts.analyserSmoothing ?? DEFAULTS.analyserSmoothing;
    this._timeDomain = new Uint8Array(this._analyser.fftSize);

    try { this._source.connect(this._analyser); } catch (e) { console.warn('connectStream:', e); }

    this._startTimer();
    this._startRender();
    return true;
  }

  // Отключение аудио
  disconnect() {
    this._stopTimer();
    this._stopRender();
    if (this._source) try { this._source.disconnect(); } catch (e) {}
    this._source = null;
    if (this._analyser) try { this._analyser.disconnect(); } catch (e) {}
    this._analyser = null;
  }

  // Подключение Node от хоста
  connectAudioNode(node) {
    if (!node || !node.context) throw new Error('connectAudioNode: ожидается AudioNode с контекстом');
    this._audioCtx = node.context;  // Используем переданный контекст
    this._analyser = this._audioCtx.createAnalyser();
    node.connect(this._analyser);
    this._onAudioLevel(1);  // Имитируем уровень звука для старта
    this._startRendering();
  }

  // Реакция на уровень звука
  _onAudioLevel(level) {
    const now = performance.now();
    if (level > 0) {  // Есть звук
      if (this._state !== 'working') {
        this._state = 'working'; // Переход в рабочее состояние
        this._startRendering();  // Начинаем рендерить
      }
      this._lastSoundTs = now;  // Обновляем время последнего звука
    } else {
      // Если нет звука и прошёл порог тишины
      if (now - this._lastSoundTs > this.silenceTimeoutMs) {
        if (this._state !== 'pause') {
          this._state = 'pause';  // Переход в паузу
          this._stopRendering();  // Останавливаем рендеринг
        }
      }
    }
  }

  // Начинаем рендеринг
  _startRendering() {
    this._rendering = true;
    requestAnimationFrame(this._renderFrame.bind(this));  // Используем RAF для анимации
  }

  // Останавливаем рендеринг
  _stopRendering() {
    this._rendering = false;
  }

  // Рендерим кадры
  _renderFrame() {
    if (this._rendering) {
      this._draw();  // Отрисовываем графику
      requestAnimationFrame(this._renderFrame.bind(this));  // Продолжаем анимацию
    }
  }

  // Отрисовываем визуализацию (полосы или другая графика)
  _draw() {
    // Пример отрисовки: рисуем на canvas
    if (this._state === 'working') {
      // Здесь логика отрисовки, когда состояние 'working'
      this._ctx.fillStyle = "green";
      this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    } else if (this._state === 'pause') {
      // Логика для состояния 'pause'
      this._ctx.fillStyle = "gray";
      this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  // Обрабатываем изменение размера контейнера
  _onResize() {
    const rect = this._container.getBoundingClientRect();
    this._canvas.width = rect.width;
    this._canvas.height = rect.height;
  }
}
