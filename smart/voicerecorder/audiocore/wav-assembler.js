// voicerecorder/audiocore/wav-assembler.js
// Builds final WAV from a list of fixed-length (or padded) segments.
// Optionally resamples to targetSampleRate for output.
export default class WavAssembler {
  constructor(opts = {}) {
    this.targetSampleRate = opts.targetSampleRate ?? null;
    this._segments = [];
    this._inputSampleRate = null;
    this._channels = 1;
  }

  addSegment(seg) {
    if (!seg || !seg.pcmInt16 || !seg.pcmInt16.length) return;
    if (!this._inputSampleRate) this._inputSampleRate = seg.sampleRate | 0;
    this._segments.push(seg);
  }

  clear() { this._segments = []; this._inputSampleRate = null; }

  buildFinalWav() {
    const inSr = this._inputSampleRate || this.targetSampleRate || 48000;
    if (!this._segments.length) {
      return this._makeWavBlob(new Int16Array(0), inSr, this._channels);
    }
    // concat int16
    let total = 0;
    for (const s of this._segments) total += s.pcmInt16.length;
    const all = new Int16Array(total);
    let p = 0;
    for (const s of this._segments) { all.set(s.pcmInt16, p); p += s.pcmInt16.length; }

    let outInt16 = all;
    let outSr = inSr;

    if (this.targetSampleRate && this.targetSampleRate !== inSr) {
      const f32 = this._int16ToFloat32(all);
      const rs = this._resampleLinear(f32, inSr, this.targetSampleRate);
      outInt16 = this._floatToInt16(rs);
      outSr = this.targetSampleRate;
    }

    return this._makeWavBlob(outInt16, outSr, this._channels);
  }

  // ===== helpers =====
  _int16ToFloat32(i16) {
    const out = new Float32Array(i16.length);
    for (let i=0;i<i16.length;i++) {
      const v = i16[i];
      out[i] = (v < 0 ? v/0x8000 : v/0x7FFF);
    }
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

  _resampleLinear(f32, inRate, outRate) {
    if (inRate === outRate) return f32;
    const ratio = outRate / inRate;
    const outLen = Math.round(f32.length * ratio);
    const out = new Float32Array(outLen);
    for (let i=0;i<outLen;i++) {
      const srcPos = i / ratio;
      const p0 = Math.floor(srcPos);
      const p1 = Math.min(p0 + 1, f32.length - 1);
      const t = srcPos - p0;
      out[i] = f32[p0] * (1 - t) + f32[p1] * t;
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
