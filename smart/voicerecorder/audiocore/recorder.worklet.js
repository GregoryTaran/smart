// recorder.worklet.js
// Простой AudioWorkletProcessor, который:
// 1) Снимает аудиоданные (моно) из входа.
// 2) Копит их в JS-массиве.
// 3) Как только накопилось >= chunkSize — отправляет Float32Array (transferable) в основной поток.
// Вся «умная» логика снаружи. Здесь — только стабильный захват и выдача чанков.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    // Размер чанка должен быть кратен 128 (render quantum); 2048 — хороший дефолт.
    this.chunkSize = Math.max(128, (opts.chunkSize | 0) || 2048);
    if (this.chunkSize % 128 !== 0) {
      this.chunkSize = Math.ceil(this.chunkSize / 128) * 128;
    }

    // JS-массив как простой буфер (достаточно для прототипа; потом можно оптимизировать)
    this._buf = [];

    // Возможность менять chunkSize «на лету»
    this.port.onmessage = (ev) => {
      const { cmd, chunkSize } = ev.data || {};
      if (cmd === 'setChunkSize' && Number.isFinite(chunkSize) && chunkSize > 0) {
        const sz = Math.floor(chunkSize / 128) * 128 || 128;
        this.chunkSize = Math.max(128, sz);
      }
    };
  }

  process(inputs, outputs, parameters) {
    // Берём первый вход, первый канал. Если каналов несколько — упрощённо берём канал 0.
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true; // нет данных — просто продолжаем
    }

    const ch0 = input[0]; // Float32Array текущего render quantum (обычно 128 сэмплов)
    // Накапливаем в обычном массиве
    // (позже можно переписать на кольцевой Float32Array без лишних копий)
    this._buf.push(...ch0);

    // Пока накоплений хватает — отдаём чанки ровно chunkSize
    while (this._buf.length >= this.chunkSize) {
      const slice = this._buf.slice(0, this.chunkSize); // Array
      this._buf = this._buf.slice(this.chunkSize);      // остаток остаётся в буфере

      // Заворачиваем в Float32Array и передаём как transferable
      const out = new Float32Array(slice);
      this.port.postMessage({ frame: out }, [out.buffer]);
    }

    // true => продолжать вызывать process()
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
