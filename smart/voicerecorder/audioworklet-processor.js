// smart/voicerecorder/audioworklet-processor.js
class ChunkerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferLen = 0;
    this.port.onmessage = (ev) => {
      // можно принять команды от основного потока
    };
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      // copy samples
      this._buffer.push(new Float32Array(channelData));
      this._bufferLen += channelData.length;
      // сообщаем основной нитке что есть аудио (для визуализации)
      this.port.postMessage({ type: 'level', rms: this._calcRMS(channelData) });
    }
    return true;
  }

  _calcRMS(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]*buf[i];
    return Math.sqrt(sum / buf.length);
  }
}

registerProcessor('chunker-processor', ChunkerProcessor);
