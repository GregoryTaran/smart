// recorder-worklet.js
// Minimal AudioWorkletProcessor that posts Float32Array frames to main thread.
// Register name must match WORKLET_NAME in context.js ("recorder-worklet").

// Note: AudioWorkletProcessor runs in audio rendering thread. Keep processing light.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._port = this.port;
    this._bufferSize = 128; // typical block size (might be 128/256/512)
    this._started = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.cmd === 'start') this._started = true;
      if (d && d.cmd === 'stop') this._started = false;
    };
  }

  process(inputs/*, outputs, parameters */) {
    if (!this._started) {
      // if not started, do nothing but keep node alive
      return true;
    }
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // take first channel (mono)
    if (!channel || channel.length === 0) return true;

    // copy to transferable typed array
    const copy = new Float32Array(channel.length);
    copy.set(channel);

    // post to main thread. Transfers not universally supported for Float32Array across all browsers,
    // but posting array.buffer can be used if receiver expects it. We'll post the typed array object.
    try {
      this.port.postMessage(copy);
    } catch(e) {
      // if transfer not allowed, post a plain array fallback
      this.port.postMessage(Array.from(copy));
    }

    return true;
  }
}

registerProcessor('recorder-worklet', RecorderProcessor);
