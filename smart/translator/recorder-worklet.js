class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0].slice(0));  // Отправка данных на основной поток
    }
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
