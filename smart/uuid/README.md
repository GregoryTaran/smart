# uuid

Небольшие утилиты для генерации идентификаторов (ES‑модули), без зависимостей.

## Файлы
- `uuid.js` — `uuidv4()` (RFC4122 v4) и `isUuidV4(str)`
- `id.js` — `rid(len=21)` — компактный URL‑safe идентификатор (похож на NanoID), по умолчанию 21 символ

## Использование
```html
<script type="module">
  import { uuidv4 } from '../uuid/uuid.js';
  import { rid } from '../uuid/id.js';

  const a = uuidv4();   // '3e1f1b88-8a3b-4d53-a2d0-b7c0f2c7b7a5'
  const b = rid();      // 'V4cC6uW_R8Q9yM3LZp0Jt'
  console.log(a, b);
</script>
```

## Примечания
- Основано на `crypto.getRandomValues`, поддерживается в современных браузерах (Chrome/Android, Safari/iOS).
- Для старых окружений без Web Crypto потребуется полифилл (в рамках нашего проекта не нужен).

## Идентификация и сессии

В проекте используются два уровня идентификаторов:

### 1) anon_user_id — «анонимный пользователь»
- Создаётся **один раз** при первом визите и хранится в `localStorage`.
- Не меняется при перезагрузке страницы.
- Сбросится при очистке данных сайта/кэша, в режиме инкогнито или в другом браузере/устройстве.
- Назначение: связать все записи одного браузера в «псевдо‑профиль».

Пример получения (уже встроено в voicerecorder.js через uuid/uuidv4):
```js
import { uuidv4 } from '../uuid/uuid.js';
let anon = localStorage.getItem('sv_anon_user_id');
if (!anon) { anon = uuidv4(); localStorage.setItem('sv_anon_user_id', anon); }
```

### 2) session_id — «текущий визит»
- Живёт в `sessionStorage` и создаётся при открытии вкладки.
- Меняется при закрытии вкладки/новом визите.
- Назначение: группировать события записи в рамках одного сеанса.

```js
import { uuidv4 } from '../uuid/uuid.js';
let session = sessionStorage.getItem('sv_session_id');
if (!session) { session = uuidv4(); sessionStorage.setItem('sv_session_id', session); }
```

### 3) recording_id и segment_id — «запись» и «сегменты»
- `recording_id` создаётся на **Start**: один на всю запись.
- `segment_id` генерируется для каждого 2‑сек сегмента.
- Имена файлов формируются так:
```
rec_<recording_id>_segNNN_<segment_id>.wav
rec_<recording_id>_final.wav
```

Мини‑пример интеграции в `voicerecorder/voicerecorder.js`:
```js
import { uuidv4 } from '../uuid/uuid.js';
import { rid }     from '../uuid/id.js';

let recordingId = null;
let segmentIdx  = 0;

async function start() {
  // ... инициализация аудио ...
  recordingId = uuidv4();
  segmentIdx = 0;
}

aggregator.onSegment = (wavBlob, meta) => {
  const segmentId = rid();
  const name = `rec_${recordingId}_seg${String(segmentIdx).padStart(3,'0')}_${segmentId}.wav`;
  // upload/download name + wavBlob
  segmentIdx++;
};

async function stop() {
  const big = aggregator.buildBigWavAndReset();
  const finalName = `rec_${recordingId}_final.wav`;
  // upload/download finalName + big
}
```

### Где это отображается
В `voicerecorder.html` вверху страницы показаны:
- **ID** (anon_user_id) — постоянный для этого браузера
- **Session** (session_id) — новый на вкладку
- **Recording** — активный recording_id во время записи

### Что можно расширить позже
- Привязать `anon_user_id` к аккаунту при логине.
- Добавить события `trackEvent(...)` на `start/segment/stop` для аналитики.
- Хранить «историю записей» локально (IndexedDB) или на сервере.
