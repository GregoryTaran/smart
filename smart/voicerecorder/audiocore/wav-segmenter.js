// voicerecorder/audiocore/wav-segmenter.js
// Emits fixed-length segments from Float32 mono stream.
// - Keeps a carry buffer, emits exact `segmentSeconds` chunks while streaming.
// - On stop():
//     * if padLastSegment=true -> pads the last partial with zeros to full length
//     * else -> emits short final segment as-is
export default class WavSegmenter {
  constructor(opts = {}) {
    this.sampleRate = (opts.sampleRate|0) || 48000;
    this.segmentSeconds = opts.segmentSeconds ?? 2;
    this.normalize = opts.normalize ?? true;
    this.normalizeTarget = opts.normalizeTarget ?? 0.99;
    this.emitBlobPerSegment = opts.emitBlobPerSegment ?? false;
    this.padLastSegment = opts.padLastSegment ?? false;
    this.onSegment = null;

    this._carry = new Float32Array(0);
    this._seq = 0;
  }

  setSampleRate(sr) { this.sampleRate = sr|0; }
  getSampleRate()   { return this.sampleRate; }
  getSegmentFrames(){ return Math.floor(this.sampleRate * this.segmentSeconds); }

  pushFrame(f32) {
    if (!f32 || !f32.length) return;
    // concat carry + current
    const merged = new Float32Array(this._carry.length + f32.length);
    merged.set(this._carry, 0);
    merged.set(f32, this._carry.length);

    const segLen = this.getSegmentFrames();
    let offset = 0;

    // emit as many full segments as we have
    while (merged.length - offset >= segLen) {
      const slice = merged.subarray(offset, offset + segLen);
      offset += segLen;
      this._emitSegment(slice, this.segmentSeconds);
    }
    // leftover goes to carry
    this._carry = merged.subarray(offset);
  }

  stop() {
    const segLen = this.getSegmentFrames();
    if (this._carry.length > 0) {
      let tail = this._carry;
      if (this.padLastSegment) {
        const padded = new Float32Array(segLen);
        padded.set(tail, 0);
        tail = padded;
        this._emitSegment(tail, this.segmentSeconds);
      } else {
        const seconds = this._carry.length / this.sampleRate;
        this._emitSegment(tail, seconds);
      }
      this._carry = new Float32Array(0);
    }
  }

  // ---- internal helpers ----
  _emitSegment(f32, durationSec) {
    const useF32 = this.normalize ? this._normalizeToTarget(f32, this.normalizeTarget) : f32;
    const pcmInt16 = this._floatToInt16(useF32);
    const segObj = {
      seq: this._seq++,
      sampleRate: this.sampleRate,
      durationSec,
      pcmInt16,
      blob: null,
    };
    if (this.emitBlobPerSegment) {
      segObj.blob = this._makeWavBlob(pcmInt16, this.sampleRate, 1);
    }
    if (typeof this.onSegment === 'function') {
      try { this.onSegment(segObj); } catch {}
    }
    return segObj;
  }

  _normalizeToTarget(f32, target=0.99) {
    let peak = 0;
    for (let i=0;i<f32.length;i++) {
      const v = Math.abs(f32[i]);
      if (v > peak) peak = v;
    }
    if (!peak || peak >= target) return f32;
    const k = target / peak;
    const out = new Float32Array(f32.length);
    for (let i=0;i<f32.length;i++) out[i] = f32[i] * k;
    return out;
  }

  _floatToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i=0;i<f32.length;i++) {
      let s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = (s < 0 ? s * 0x8000 : s * 0x7FFF) | 0;
    }
    return out;
  }

  _makeWavBlob(int16, sampleRate, channels=1) {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = int16.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let off = 0;
    const W = (s) => { for (let i=0;i<s.length;i++) view.setUint8(off++, s.charCodeAt(i)); };
    const U16 = (v) => { view.setUint16(off, v, true); off += 2; };
    const U32 = (v) => { view.setUint32(off, v, true); off += 4; };

    W('RIFF'); U32(36 + dataSize); W('WAVE');
    W('fmt '); U32(16); U16(1); U16(channels);
    U32(sampleRate); U32(byteRate); U16(blockAlign); U16(16);
    W('data'); U32(dataSize);

    const u8 = new Uint8Array(buffer, 44);
    let p = 0;
    for (let i=0;i<int16.length;i++) {
      u8[p++] = int16[i] & 0xFF;
      u8[p++] = (int16[i] >> 8) & 0xFF;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }
}
