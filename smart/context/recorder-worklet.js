class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // ✅ создаём копию, иначе браузер отдаёт нули или мусор
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor("recorder-processor", RecorderProcessor);
