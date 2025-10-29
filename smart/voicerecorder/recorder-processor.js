// recorder-processor.js (AudioWorkletProcessor)
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 128; // внутренняя фрейм-единица
  }

  process(inputs/*, outputs, parameters*/) {
    const input = inputs[0];
    if (input && input[0]) {
      // клонируем Float32Array и отправляем в main thread (transferable)
      const channelData = input[0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
