// recorder-worklet.js
// Simple AudioWorkletProcessor that posts Float32Array buffers to main thread.
// It copies the input buffer (slice) to avoid reusing the input memory, computes RMS and posts
// { buffer: ArrayBuffer, rms: Number } as a single transferable message.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // nothing to init for now
  }

  process(inputs/*, outputs, parameters */) {
    try {
      const input = inputs[0];
      if (!input || input.length === 0) return true;
      // use first channel only (mono)
      const channelData = input[0];
      if (!channelData) return true;

      // Copy data to avoid referencing the shared buffer
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);

      // compute RMS for level meter
      let sum = 0;
      for (let i = 0; i < copy.length; i++) {
        const v = copy[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / copy.length) || 0;

      // send transferable ArrayBuffer + rms
      // Note: we post {buffer, rms} but transfer only the buffer
      this.port.postMessage({ buffer: copy.buffer, rms }, [copy.buffer]);
    } catch (e) {
      // avoid throwing (worklet context)
      // console.log('worklet error', e);
    }
    return true;
  }
}

registerProcessor('recorder.processor', RecorderProcessor);
