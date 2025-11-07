// audioworklet-processor.js
// AudioWorkletProcessor: собирает фиксированные чанки и шлёт их в main thread.
// - Ожидает конфигурацию: { type:'config', chunk_samples, sample_rate, channels }
// - При заполнении буфера шлёт {type:'chunk', buffer: ArrayBuffer, valid_samples: N}
// - На flush шлёт полный буфер, заполненный нулями, с valid_samples = текущий writeIndex

class ChunkerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSamples = 0;
    this.sampleRate = sampleRate || 48000;
    this.channels = 1;
    this._buffer = null;
    this._writeIndex = 0;

    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d) return;
      if (d.type === 'config') {
        this.chunkSamples = Number(d.chunk_samples) || Math.round(this.sampleRate * 2);
        this.sampleRate = Number(d.sample_rate) || this.sampleRate;
        this.channels = Number(d.channels) || this.channels;
        this._ensureBuffer();
      } else if (d.type === 'flush') {
        if (this._writeIndex > 0) {
          const full = new Float32Array(this.chunkSamples); // zero filled
          full.set(this._buffer.subarray(0, this._writeIndex), 0);
          this.port.postMessage({ type: 'chunk', buffer: full.buffer, valid_samples: this._writeIndex }, [full.buffer]);
          this._writeIndex = 0;
        }
      }
    };
  }

  _ensureBuffer() {
    if (!this.chunkSamples) return;
    if (!this._buffer || this._buffer.length !== this.chunkSamples) {
      this._buffer = new Float32Array(this.chunkSamples);
      this._writeIndex = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true;
    }
    const ch = input[0];
    if (!this._buffer) this._ensureBuffer();
    let offset = 0;
    while (offset < ch.length) {
      const remaining = this._buffer.length - this._writeIndex;
      const toCopy = Math.min(remaining, ch.length - offset);
      this._buffer.set(ch.subarray(offset, offset + toCopy), this._writeIndex);
      this._writeIndex += toCopy;
      offset += toCopy;
      if (this._writeIndex >= this._buffer.length) {
        const sendBuf = new Float32Array(this._buffer);
        this.port.postMessage({ type: 'chunk', buffer: sendBuf.buffer, valid_samples: sendBuf.length }, [sendBuf.buffer]);
        this._writeIndex = 0;
      }
    }

    // lightweight RMS level for VU
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length || 0);
    this.port.postMessage({ type: 'level', rms });

    return true;
  }
}

registerProcessor('chunker-processor', ChunkerProcessor);
