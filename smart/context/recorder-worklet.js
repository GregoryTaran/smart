// /context/recorder-worklet.js
// Minimal AudioWorkletProcessor; harmless if unused.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._started = false; this.port.onmessage = e => {
      if (e.data && e.data.cmd === 'start') this._started = true;
      if (e.data && e.data.cmd === 'stop') this._started = false;
    };
  }
  process(inputs) {
    // lightweight: do nothing unless explicitly started
    if (!this._started) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const copy = new Float32Array(input[0].length);
    copy.set(input[0]);
    try { this.port.postMessage(copy); } catch(e) { this.port.postMessage(Array.from(copy)); }
    return true;
  }
}
registerProcessor('recorder-worklet', RecorderProcessor);
