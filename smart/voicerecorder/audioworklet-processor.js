// audioworklet-processor.js
// Chunker AudioWorkletProcessor — собирает float32 сэмплы и посылает на main thread
class ChunkerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = null;
    this._bufferLen = 0;
    this._writeIndex = 0;

    // default chunk length seconds (can be overridden by main thread via message)
    this.chunkSeconds = 2;
    this.sampleRate = sampleRate; // provided by environment

    this._ensureBuffer();

    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d) return;
      if (d.type === 'set_chunk_seconds') {
        this.chunkSeconds = Number(d.value) || 2;
        this._ensureBuffer();
      } else if (d.type === 'flush') {
        // send any partially filled buffer immediately
        if (this._writeIndex > 0) {
          const partial = new Float32Array(this._writeIndex);
          partial.set(this._buffer.subarray(0, this._writeIndex));
          this.port.postMessage({ type: 'chunk', buffer: partial.buffer }, [partial.buffer]);
          this._writeIndex = 0;
        }
      }
    };
  }

  _ensureBuffer() {
    const needed = Math.max(1, Math.round(this.sampleRate * this.chunkSeconds));
    if (!this._buffer || this._buffer.length !== needed) {
      this._buffer = new Float32Array(needed);
      this._bufferLen = needed;
      this._writeIndex = 0;
    }
  }

  process(inputs/*, outputs, params */) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true;
    }
    const channelData = input[0];
    let offset = 0;
    while (offset < channelData.length) {
      const remaining = this._buffer.length - this._writeIndex;
      const toCopy = Math.min(remaining, channelData.length - offset);
      this._buffer.set(channelData.subarray(offset, offset + toCopy), this._writeIndex);
      this._writeIndex += toCopy;
      offset += toCopy;

      if (this._writeIndex >= this._buffer.length) {
        // buffer full — transfer to main thread
        const sendBuf = new Float32Array(this._buffer);
        this.port.postMessage({ type: 'chunk', buffer: sendBuf.buffer }, [sendBuf.buffer]);
        this._writeIndex = 0;
      }
    }

    // VU meter RMS message (lightweight)
    const rms = this._calcRMS(channelData);
    this.port.postMessage({ type: 'level', rms });

    return true;
  }

  _calcRMS(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }
}

registerProcessor('chunker-processor', ChunkerProcessor);
