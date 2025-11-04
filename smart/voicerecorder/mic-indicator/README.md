# Mic Indicator (ESM) — Smart Vision

Лёгкий ESM-класс индикатора уровня микрофона. 
Показывает тонкую серую baseline в тишине и тонкие зеркально-симметричные палочки при речи.
Предназначен для встраивания в микросервисы/страницы.

## Что в папке
- `mic-indicator.js` — ESM класс `export default MicIndicator`.
- `mic-indicator.css` — стили с CSS-переменными (уникальный префикс `--svmic-`).
- Этот README — инструкция по интеграции.

## Быстрая интеграция (статичная страница)
1. Положите папку `mic-indicator` рядом с вашей страницей, например:
   `/VoiceRecorder/mic-indicator/`

2. Подключите CSS в `<head>`:
```html
<link rel="stylesheet" href="./mic-indicator/mic-indicator.css">


# Mic-Indicator — Smart Vision

## Назначение
**Mic-Indicator** — небольшой автономный модуль-визуализатор, показывающий наличие речи в микрофонном потоке.  
Цель: дать пользователю понятный визуальный сигнал — «микрофон активен / слышит голос» — без сложной логики и без вмешательства в остальной код записи.

## Содержимое папки
```
mic-indicator/
  mic-indicator.js       # ESM класс — основной модуль
  mic-indicator.css      # стили (все переменные с префиксом --svmic-)
  README.md              # эта инструкция
```

## Как это работает — кратко
- Визуализация основана на RMS уровнях аудиосигнала (анализатор `AnalyserNode` или входные значения из AudioWorklet).
- Если нет активности — показывается тонкая серая baseline.
- При речи — отображаются тонкие зеркальные палочки (вверх/вниз), каждая палочка — отдельный шаг (stepMs).
- Для интеграции рекомендуется передавать уже существующий `MediaStream` (через `connectStream`) из вашего модуля записи, чтобы не создавать лишних AudioContext и не запрашивать разрешения повторно.

## API (ESM class)
Импорт и создание:
```js
import MicIndicator from './mic-indicator/mic-indicator.js';

const indicator = new MicIndicator(containerElement, {
  stepMs: 100,        // ms per step (default ~100)
  sensitivity: 0.9,   // 0..3
  barWidthMm: 0.85,   // mm
  gapPx: 2,
  minVisible: 0.03
});
```

Методы:
- `await indicator.connectMic()` — запросить микрофон (user gesture).
- `await indicator.connectStream(mediaStream)` — подключить существующий MediaStream (рекомендовано).
- `indicator.disconnect()` — остановить визуализацию (сохранить DOM).
- `indicator.destroy()` — полная очистка, удаление DOM и закрытие AudioContext.
- `indicator.setStepMs(ms)`, `indicator.setSensitivity(v)`, `indicator.setBarWidthMm(mm)`.
- `indicator.setSimLevel(v)` — задать синтетический уровень 0..1 (для тестов).

События:
- `indicator.on('connect', fn)`, `indicator.on('disconnect', fn)`, `indicator.on('level', fn)`, `indicator.on('error', fn)`, `indicator.on('destroy', fn)`.
Возвращаемая функция от `on` позволяет отписаться.

## Рекомендуемая интеграция (пример)
1. Добавьте styles:
```html
<link rel="stylesheet" href="voicerecorder/mic-indicator/mic-indicator.css">
```
2. Поместите контейнер (уже есть на странице в `voicerecorder.html`):
```html
<div id="vc-level" class="vc-level sv-mic-indicator"></div>
```
3. В `voicerecorder.js`, когда у вас есть `mediaStream`:
```js
import MicIndicator from './mic-indicator/mic-indicator.js';
const indicator = new MicIndicator(document.querySelector('#vc-level'));
indicator.connectStream(mediaStream);
```
Либо, если вы используете AudioWorklet и уже вычисляете RMS, отправляйте значения:
```js
workletNode.port.onmessage = (e) => {
  if (e.data.type === 'level') {
    indicator.setSimLevel(Math.min(1, e.data.rms * 6));
  }
};
```

## CSS-переменные (уникальные, префикс --svmic-)
Переопределяйте в локальном CSS:
- `--svmic-height` — высота индикатора (например `14mm`)
- `--svmic-bar-color` — цвет палочек
- `--svmic-baseline-color` — цвет базовой линии
- `--svmic-gap-px` — gap между палочками
- `--svmic-bar-width-mm` — ширина палочки (мм)
- `--svmic-padding-px` — отступы внутри контейнера
- `--svmic-shadow` — тень

Пример переопределения:
```css
#vc-level {
  --svmic-height: 13mm;
  --svmic-bar-width-mm: 0.75mm;
  --svmic-gap-px: 3px;
  --svmic-bar-color: #000;
}
```

## Производительность и рекомендации
- `AnalyserNode.fftSize = 1024` — быстрый и стабильный RMS.
- Предпочтительно использовать `connectStream` и единый `MediaStream`, чтобы не создавать много AudioContext.
- `stepMs` влияет на плотность и скорость бегущей линии (рекомендуется 80–140 ms).

## Отладка
- Если ничего не отображается: проверьте наличие контейнера `#vc-level`.
- Для теста вызывайте `indicator.setSimLevel(0.8)` в консоли.
- Убедитесь, что `workletNode.port.onmessage` передаёт объект `{type:'level', rms: <float>}` при использовании AudioWorklet.

## Частые задачи развития
- Добавить опцию `shareAudioContext` (если понадобится центральное управление).
- Сделать UMD/minified вариант для старых страниц.
- Автоинициализатор по атрибуту `data-svmic` (drop-in без JS импорта).

---

## Контакты и дальнейшие шаги
Если нужно — могу:
- добавить minified bundle,
- сделать auto-init helper,
- интегрировать порог (gate) для подавления фонового шума.

Скопируйте эту README.md в репозиторий модуля и используйте как основную документацию.
