# **1\. Общая архитектура на сегодня**

Система состоит из четырёх основных кусков:

1. **Фронт (браузер):**

   * HTML-страница `voicerecorder.html`.  
      voicerecorder

   * Основной JS-контроллер `voicerecorder.js`.  
      voicerecorder

   * Аудиоядро:

     * `sv-audio-core.js` — работа с микрофоном, AudioContext, worklet.  
        sv-audio-core

     * `recorder.worklet.js` — AudioWorkletProcessor, отдаёт фреймы Float32.  
        recorder.worklet

   * Аудио-сегментер: `wav-segmenter.js`.  
      wav-segmenter

   * Визуальный индикатор микрофона: `mic-indicator.js`.  
      mic-indicator

2. **WebSocket-протокол:**

   * один маршрут `ws://.../ws/voicerecorder`;

   * текстовые сообщения: `START { ... }`, `END`;

   * бинарные сообщения: 2-секундные WAV-сегменты.  
      voicerecorder

3. **Бэкенд (FastAPI \+ pydub \+ Supabase):**

   * роутер `server/voicerecorder/ws_voicerecorder.py` с `@router.websocket("/ws/voicerecorder")`;  
      ws\_voicerecorder

   * собирает WAV-сегменты в `AudioSegment`,

   * клеит в один трек,

   * конвертирует в MP3,

   * загружает в Supabase Storage,

   * создаёт запись в таблице `voicerecorder_records`.  
      ws\_voicerecorder

4. **Supabase:**

   * bucket: `sv-storage`;

   * папка: `voicerecorder/user-{user_id}/{rec_id}.mp3`;  
      ws\_voicerecorder

   * таблица `public.voicerecorder_records` (структуру ты описывал текстом).

---

# **2\. Фронт: страница и DOM**

`/voicerecorder/voicerecorder.html` содержит:

voicerecorder

* кнопки:

  * `#startBtn`

  * `#pauseBtn`

  * `#stopBtn`

* статус: `<span id="status">`

* список записей: `<ul id="record-list">`

* плеер: `<audio id="sv-player">`

* контейнер под индикатор: `<div id="micIndicator">` (сейчас мы на него опираемся)

* подключается скрипт `voicerecorder.js` как `type="module"`.

В `voicerecorder.js` мы делаем:

`const statusEl = document.getElementById("status");`  
`const startBtn  = document.getElementById("startBtn");`  
`const pauseBtn  = document.getElementById("pauseBtn");`  
`const stopBtn   = document.getElementById("stopBtn");`  
`const playerEl  = document.getElementById("sv-player");`  
`const listEl    = document.getElementById("record-list");`  
`const micIndicatorEl = document.getElementById("micIndicator");`  
`:contentReference[oaicite:11]{index=11}`

---

# **3\. Аудиопайплайн на фронте: от микрофона до WAV-сегментов**

## **3.1. SVAudioCore \+ worklet**

В `start()` мы:

1. создаём `SVAudioCore`:

`core = new SVAudioCore({`  
  `chunkSize: 2048,`  
  `workletUrl: "voicerecorder/audiocore/recorder.worklet.js",`  
`});`  
`await core.init();`  
`console.log("🎛️ [CORE] AudioContext SR =", core.getContext()?.sampleRate);`  
`:contentReference[oaicite:12]{index=12}`

`SVAudioCore` внутри:

sv-audio-core

* создаёт `AudioContext`;

* через `audioContext.audioWorklet.addModule(workletUrl)` грузит `recorder.worklet.js`;

* запрашивает `getUserMedia({ audio: true })`;

* строит граф: `MediaStreamSource → (gain/компрессор) → AudioWorkletNode`;

* сохраняет:

  * `this.stream` — исходный `MediaStream` (для индикатора),

  * `this.onAudioFrame` — колбэк, куда worklet шлёт фреймы.

В worklet (`recorder.worklet.js`):

recorder.worklet

* `process(inputs, outputs, params)` получает массивы сэмплов `Float32`;

* накапливает их в буфере фиксированного размера (`chunkSize`);

* как только накопилось `chunkSize` сэмплов — отсылает в main thread:

`this.port.postMessage({ frame: Float32Array.from(buffer) });`

`SVAudioCore` ловит это в:

`_recorderNode.port.onmessage = (event) => {`  
  `const { frame } = event.data || {};`  
  `if (frame && this.onAudioFrame) this.onAudioFrame(frame);`  
`};`  
`:contentReference[oaicite:15]{index=15}`

## **3.2. WavSegmenter: режем поток в 2-секундные WAV**

Мы создаём `WavSegmenter` так:

voicerecorder

`segmenter = new WavSegmenter({`  
  `sampleRate: core.getContext()?.sampleRate || 48000,`  
  `segmentSeconds: 2,`  
  `normalize: true,`  
  `emitBlobPerSegment: true`  
  `// padLastSegment по умолчанию = true`  
`});`

Внутри `wav-segmenter.js`:

wav-segmenter

* `sampleRate` берётся из опций или 48000;

* `segmentSeconds` по умолчанию 2;

* `padLastSegment` по умолчанию **true** (наша правка), т.е. последний сегмент тоже добивается нулями до полного размера;

* хранит внутренний буфер `_carry` и счётчик `_seq`.

### **Как он режет:**

В `pushFrame(f32)`:

wav-segmenter

* конкатенирует `_carry` \+ новый фрейм в `merged`;

* считает `segLen = sampleRate * segmentSeconds` (кол-во сэмплов на 2 сек);

* пока в `merged` хватает данных на полный сегмент:

  * берёт кусок `merged.subarray(offset, offset + segLen)`,

  * вызывает `_emitSegment(slice, this.segmentSeconds)`,

  * увеличивает `offset`;

* остаток (`merged.subarray(offset)`) пишет обратно в `_carry`.

В `stop()` (важно):

wav-segmenter

* если в `_carry` что-то осталось:

  * если `padLastSegment = true` →

    * создаёт `padded = new Float32Array(segLen)`,

    * копирует хвост в начало, остальное заполняется нулями,

    * `_emitSegment(padded, segmentSeconds)` — т.е. **последний сегмент тоже ровно 2 секунды**;

  * если `false` — посылает коротыш.

`_emitSegment`:

* при необходимости нормализует сигнал;

* конвертит `Float32Array` → `Int16Array` (PCM);

* если `emitBlobPerSegment = true`, создаёт корректный WAV-заголовок и `Blob` (`audio/wav`).  
   wav-segmenter

* вызывает `this.onSegment(segObj)`.

## **3.3. Привязка аудио к сегментеру и индикатору**

В `voicerecorder.js` мы вешаем:

voicerecorder

`core.onAudioFrame = (f32) => {`  
  `// индикатор уровня (RMS)`  
  `if (indicator) {`  
    `const rms = Math.sqrt(f32.reduce((s, v) => s + v * v, 0) / f32.length);`  
    `indicator.setSimLevel(rms);`  
  `}`

  `// сегментация`  
  `if (segmenter) {`  
    `segmenter.pushFrame(f32);`  
  `}`  
`};`

Таким образом:

* один и тот же поток Float32:

  * идёт в `MicIndicator` — для визуализации,

  * идёт в `WavSegmenter` — для нарезки на WAV.

---

# **4\. Индикатор микрофона**

Файл: `mic-indicator.js`.

mic-indicator

## **4.1. Что он делает**

`MicIndicator` — чисто визуальный компонент:

* рендерит бары на `<canvas>` внутри контейнера `micIndicatorEl`;

* имеет внутренний стейт:

  * `initial` — базовая линия, нет движения,

  * `working` — звук есть, рисует колеблющиеся бары,

  * `pause` — тишина дольше заданного таймаута, кадр замирает;  
     mic-indicator

* сам по себе **ничего наружу не эмитит**, только рисует.

## **4.2. Подключение к реальному потоку**

Через `connectStream(mediaStream)`:

mic-indicator

* создаёт `AudioContext` (если ещё нет),

* создаёт `MediaStreamSource` из `mediaStream`,

* создаёт `AnalyserNode`,

* начинает:

  * таймер (`setInterval`), который раз в `stepMs`:

    * снимает `getByteTimeDomainData`,

    * считает RMS, пики, нормализует уровень,

    * пишет уровни в кольцевой буфер `_buf`,

    * отслеживает тишину/работу;

  * рендер-цикл через `requestAnimationFrame` → `_renderOnce()`.

В нашем случае мы делаем:

`if (!indicator && micIndicatorEl) {`  
  `indicator = new MicIndicator(micIndicatorEl);`  
`}`  
`if (indicator && core.stream) {`  
  `await indicator.connectStream(core.stream);`  
`}`  
`:contentReference[oaicite:25]{index=25}`

То есть индикатор получает Тот Же `MediaStream`, что и `SVAudioCore`.

## **4.3. Связка с симулированным уровнем**

Дополнительно мы подаём ему RMS через `setSimLevel(v)` в `core.onAudioFrame` (см. выше).  
 Сейчас это больше дубль, но:

* `connectStream` даёт “реальный” анализ через `AnalyserNode`;

* `setSimLevel` может быть использован, если захочешь “виртуальный” режим, без медиастрима (например, играть с готовыми данными).

При `stop()` мы делаем:

`if (indicator) indicator.setInactive();`  
`:contentReference[oaicite:26]{index=26}`

Это сбрасывает буфер и возвращает индикатор в состояние `initial`.

---

# **5\. WebSocket-протокол: START / WAV / END**

## **5.1. На фронте**

Подключение:

voicerecorder

`const proto = location.protocol === "https:" ? "wss" : "ws";`  
``const url = `${proto}://${location.host}/ws/voicerecorder`;``  
`ws = new WebSocket(url);`

При `onopen`:

`ws.send(`  
  `"START " +`  
  `JSON.stringify({ user_id: userId, rec_id: recId, ext: ".wav" })`  
`);`  
`:contentReference[oaicite:28]{index=28}`

Дальше, каждый раз, когда `WavSegmenter` выдаёт сегмент, мы отправляем бинарь:

voicerecorder

`segmenter.onSegment = (seg) => {`  
  `if (!seg?.blob) return;`  
  `if (!ws || ws.readyState !== WebSocket.OPEN) { ...; return; }`

  `console.log("📦 [SEG] send chunk seq", seg.seq, "dur", seg.durationSec.toFixed(2), "blob", seg.blob.size);`

  `ws.send(seg.blob); // Blob напрямую`  
`};`

При `stop()`:

1. `segmenter.stop()` добирает последний 2-секундный сегмент и тоже уходит в `onSegment → ws.send(blob)`.  
    wav-segmenter

2. После этого:

`await stopWS(); // внутри ws.send("END");`  
`:contentReference[oaicite:31]{index=31}`

Т.е. **протокол** со стороны клиента:

1. `START { user_id, rec_id, ext: ".wav" }` — текст.

2. `chunk 0` — бинарный WAV 2 сек.

3. `chunk 1`

4. ...

5. `chunk N` — последний WAV 2 сек (с паддингом).

6. `END` — текст.

## **5.2. Ответ сервера**

Сервер в конце шлёт:

`await ws.send_text(json.dumps({"status": "SAVED", "url": file_url}))`  
`:contentReference[oaicite:32]{index=32}`

Фронт ловит это:

voicerecorder

`const d = JSON.parse(ev.data);`  
`if (d.status === "SAVED") {`  
  `// добавляем ссылку в список`  
  `// подставляем в <audio>`  
  `setStatus("saved");`  
`}`

---

# **6\. Бэкенд: сборка и сохранение записи**

Файл: `server/voicerecorder/ws_voicerecorder.py`.

ws\_voicerecorder

## **6.1. Инициализация**

В начале:

`SUPABASE_URL = os.getenv("SUPABASE_URL")`  
`SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")`  
`supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`

`BUCKET = "sv-storage"`  
`FOLDER = "voicerecorder"  # => voicerecorder/user-{user_id}/{rec_id}.mp3`  
`:contentReference[oaicite:35]{index=35}`

## **6.2. Жизненный цикл WS-сессии**

`@router.websocket("/ws/voicerecorder")`  
`async def ws_voicerecorder(ws: WebSocket):`  
    `await ws.accept()`  
    `await ws.send_text("Connected")`

    `meta: dict = {}`  
    `segments: list[AudioSegment] = []`  
`:contentReference[oaicite:36]{index=36}`

В цикле:

### **START**

`if text.startswith("START"):`  
    `payload_text = text[5:].strip()`  
    `payload = json.loads(payload_text or "{}")`

    `meta["user_id"] = payload.get("user_id")`  
    `meta["rec_id"] = payload.get("rec_id") or str(uuid.uuid4())`  
    `meta["ext"] = payload.get("ext") or ".wav"`

    `if not meta["user_id"]:`  
        `await ws.send_text("ERR no user_id")`  
        `continue`

    `segments = []`  
    `await ws.send_text("ACK START")`  
`:contentReference[oaicite:37]{index=37}`

### **BINARY (каждый кусок)**

`elif "bytes" in msg:`  
    `raw = msg["bytes"]`  
    `if not raw:`  
        `continue`

    `try:`  
        `seg_audio = AudioSegment.from_file(io.BytesIO(raw), format="wav")`  
        `segments.append(seg_audio)`  
    `except Exception as e:`  
        `await ws.send_text(f"ERR bad-segment: {e}")`  
`:contentReference[oaicite:38]{index=38}`

То есть **каждый кусок хранится в памяти** в виде `AudioSegment` в списке `segments`.

### **END**

`elif text.startswith("END"):`  
    `if not meta.get("user_id"):`  
        `await ws.send_text("ERR no user/session")`  
        `continue`  
    `if not segments:`  
        `await ws.send_text("ERR no segments")`  
        `continue`

    `# Склеиваем все WAV-сегменты`  
    `full_audio = segments[0]`  
    `for seg in segments[1:]:`  
        `full_audio += seg`  
`:contentReference[oaicite:39]{index=39}`

### **Конвертация в MP3 и загрузка**

`mp3_buf = io.BytesIO()`  
`full_audio.export(mp3_buf, format="mp3", bitrate="128k")`  
`mp3_buf.seek(0)`

`user_id = meta["user_id"]`  
`rec_id = meta["rec_id"]`  
`filename = f"{rec_id}.mp3"`  
`storage_path = f"{FOLDER}/user-{user_id}/{filename}"`

`supabase.storage.from_(BUCKET).upload(storage_path, mp3_buf.read())`  
`signed = supabase.storage.from_(BUCKET).create_signed_url(`  
    `storage_path,`  
    `expires_in=60 * 60 * 24 * 365 * 10  # 10 лет`  
`)`  
`file_url = signed.get("signedURL")`  
`:contentReference[oaicite:40]{index=40}`

### **Запись в БД**

`supabase.table("voicerecorder_records").insert({`  
    `"user_id": user_id,`  
    `"rec_id": rec_id,`  
    `"file_name": filename,`  
    `"file_url": file_url,`  
    `"storage_path": storage_path,`  
    `"format": "mp3",`  
    `"duration_seconds": int(full_audio.duration_seconds),`  
    `"size_bytes": len(mp3_buf.getvalue()),`  
    `"created_at": datetime.utcnow().isoformat()`  
`}).execute()`  
`:contentReference[oaicite:41]{index=41}`

---

# **7\. Структура таблицы `voicerecorder_records`**

По твоему описанию (логическая модель):

* `id` — `uuid pk default gen_random_uuid()`

* `user_id` — `uuid not null`

* `rec_id` — `text not null`

* `display_name` — `text null`

* `file_name` — `text null`

* `file_url` — `text null`

* `storage_path` — `text null`

* `format` — `text default 'mp3'`

* `duration_seconds` — `integer null`

* `size_bytes` — `bigint null`

* `created_at` — `timestamptz default now()`

* `updated_at` — `timestamptz default now()`

* `notes` — `text null`

Сейчас бекенд заполняет минимум: `user_id`, `rec_id`, `file_name`, `file_url`, `storage_path`, `format`, `duration_seconds`, `size_bytes`, `created_at`.

ws\_voicerecorder

Остальное (`display_name`, `notes`, `updated_at`, …) можно будет заполнять позже (переименования, подписи, комментарии).

---

# **8\. Инварианты и договорённости, которые мы уже закрепили**

1. **Все аудио-сегменты — строго по 2 секунды**, включая последний:

   * это гарантируется `segmentSeconds=2` \+ `padLastSegment=true` в `WavSegmenter`.  
      wav-segmenter

2. **Одна запись \= одна WS-сессия.**

   * Один `START`, набор BINARY-сообщений, один `END`.

3. **Пауза на фронте** — это просто пауза в захвате аудиофреймов:

   * core.pauseCapture()/resumeCapture() рвёт/восстанавливает граф,

   * серверу не важно — он видит только последовательность сегментов.

4. **Фронтовый STOP ≠ серверный STOP:**

   * при `stop()`:

     * мы просим сегментер добрать последний сегмент,

     * отправляем `END`,

     * сервер только после `END` начинает склейку и конвертацию.  
        voicerecorder

5. **Сервер хранит всё в RAM до конца записи:**

   * список `segments: list[AudioSegment]`;

   * в конце один большой `full_audio` тоже в памяти.

6. **Индикатор микрофона использует тот же MediaStream**, что и запись:

   * `indicator.connectStream(core.stream)`.  
      voicerecorder

---

# **9\. Что ещё важно помнить на завтра / TODO**

Чтобы завтра быстро продолжить, вот короткий чек-лист:

1. **Фронтовый баг при быстром Start→Stop:**

   * иногда `core.onAudioFrame` ещё стреляет после того, как `segmenter = null`,

   * решение: добавить защиту `if (!segmenter) return;` и обнулить `core.onAudioFrame` в `stop()` (мы это ещё не внедрили).

2. **Лимиты на длительность / размер записи:**

   * на сервере сейчас нет ограничений — можно теоретически часами писать,

   * нужно будет добавить:

     * максимум сегментов,

     * максимум `duration_seconds`,

     * обработку случая “слишком длинно”.

3. **Проверка sampleRate / формата на сервере:**

   * сейчас сервер доверяет, что каждый BINARY — валидный WAV,

   * позже можно добавить:

     * проверку `seg.frame_rate`,

     * проверку каналов (моно),

     * hard-fail при несоответствии.

4. **UI для списка записей:**

   * сейчас фронт добавляет `<li><a href="url">url</a></li>`, без имени и дополнительной инфы.  
      voicerecorder

   * в будущем можно использовать:

     * `display_name`,

     * `duration_seconds`,

     * `created_at`.

5. **Дополнительные фичи (на потом):**

   * транскрипция,

   * переименование записи,

   * удаление,

   * лимиты на количество записей на пользователя,

   * индикатор “загрузка/сохранение”.

---

Бро, этот текст — твой **боевой паспорт текущей версии диктофона**.

