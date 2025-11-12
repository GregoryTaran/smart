// voicerecorder/audiocore/wav-segmenter.js
// Emits fixed-length segments from Float32 mono stream.
// - Keeps a carry buffer, emits exact `segmentSeconds` chunks while streaming.
// - On stop():
//     * if padLastSegment=true -> pads the last partial with zeros to full length
//     * else -> emits short final segment as-is
export default class WavSegmenter {
  constructor(opts = {}) {
    // sampleRate: стараемся быть аккуратными, если придёт что-то странное
    this.sampleRate = (opts.sampleRate | 0) || 48000;
    if (!Number.isFinite(this.sampleRate) || this.sampleRate <= 0) {
      this.sampleRate = 48000;
    }

    // сколько секунд длится один сегмент (по умолчанию 2)
    this.segmentSeconds =
      typeof opts.segmentSeconds === "number" && opts.segmentSeconds > 0
        ? opts.segmentSeconds
        : 2;

    this.normalize = opts.normalize ?? true;
    this.normalizeTarget =
      typeof opts.normalizeTarget === "number" ? opts.normalizeTarget : 0.99;

    this.emitBlobPerSegment = !!opts.emitBlobPerSegment;

    // ВАЖНО: по умолчанию последний сегмент тоже паддится до полной длины
    this.padLastSegment =
      typeof opts.padLastSegment === "boolean" ? opts.padLastSegment : true;

    this.onSegment = null;

    this._carry = new Float32Array(0);
    this._seq = 0;
  }

  setSampleRate(sr) {
    const n = sr | 0;
    if (Number.isFinite(n) && n > 0) {
      this.sampleRate = n;
    }
  }

  getSampleRate() {
    return this.sampleRate;
  }

  getSegmentFrames() {
    // кол-во сэмплов в одном сегменте, считаем каждый раз из актуального sampleRate
    const frames = Math.floor(this.sampleRate * this.segmentSeconds);
    return frames > 0 ? frames : 1;
  }

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
        // Паддим последнюю часть до полного сегмента:
        // - реальный звук в начале
        // - тишина (нули) до конца сегмента
        const padded = new Float32Array(segLen);
        const copyLen = Math.min(tail.length, segLen);
        padded.set(tail.subarray(0, copyLen), 0);
        tail = padded;
        this._emitSegment(tail, this.segmentSeconds);
      } else {
        // Режим "как есть" — короткий последний сегмент
        const seconds = this._carry.length / this.sampleRate;
        this._emitSegment(tail, seconds);
      }

      this._carry = new Float32Array(0);
    }
  }

  // ---- internal helpers ----
  _emitSegment(f32, durationSec) {
    const useF32 = this.normalize
      ? this._normalizeToTarget(f32, this.normalizeTarget)
      : f32;
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
    if (typeof this.onSegment === "function") {
      try {
        this.onSegment(segObj);
      } catch {
        // глушим ошибки в пользовательском колбэке, чтобы не срубать поток
      }
    }
    return segObj;
  }

  _normalizeToTarget(f32, target = 0.99) {
    let peak = 0;
    for (let i = 0; i < f32.length; i++) {
      const v = Math.abs(f32[i]);
      if (v > peak) peak = v;
    }
    if (!peak || peak >= target) return f32;
    const k = target / peak;
    const out = new Float32Array(f32.length);
    for (let i = 0; i < f32.length; i++) out[i] = f32[i] * k;
    return out;
  }

  _floatToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      let s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = (s < 0 ? s * 0x8000 : s * 0x7fff) | 0;
    }
    return out;
  }

  _makeWavBlob(int16, sampleRate, channels = 1) {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = int16.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let off = 0;
    const W = (s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i));
    };
    const U16 = (v) => {
      view.setUint16(off, v, true);
      off += 2;
    };
    const U32 = (v) => {
      view.setUint32(off, v, true);
      off += 4;
    };

    W("RIFF");
    U32(36 + dataSize);
    W("WAVE");
    W("fmt ");
    U32(16);
    U16(1);
    U16(channels);
    U32(sampleRate);
    U32(byteRate);
    U16(blockAlign);
    U16(16);
    W("data");
    U32(dataSize);

    const u8 = new Uint8Array(buffer, 44);
    let p = 0;
    for (let i = 0; i < int16.length; i++) {
      u8[p++] = int16[i] & 0xff;
      u8[p++] = (int16[i] >> 8) & 0xff;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }
}
