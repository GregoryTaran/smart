Обновлённый README.md (удалил упоминания о maxBars)
# Mic Indicator (ESM) — Smart Vision

Лёгкий, автономный ES module-индикатор уровня микрофона.  
Показывает тонкую серую baseline в тишине и зеркальные палочки при голосе.  
Предназначен для аккуратной интеграции в Voice Recorder и другие UI.

## Содержимое папки
- `mic-indicator.js` — ESM-класс `export default MicIndicator`.
- `mic-indicator.css` — стили с CSS-переменными (`--svmic-*`).
- `README.md` — этот файл.

## Основная идея
- **Контейнер-управление шириной.** Контролируйте видимую длину индикатора через CSS контейнера (например `#vc-level { min-width:120px; max-width:2600px; }`). Компонент сам адаптируется к доступной ширине.  
- **Off-by-default.** Компонент рисует тонкую серую baseline после монтирования; активную анимацию запускает только явный вызов `connectStream(mediaStream)`.  
- **Без автоподключения** — обязательное правило: не подключаем поток при загрузке страницы.

## Быстрая интеграция
1. Положите папку рядом со страницей (пример):


/VoiceRecorder/voicerecorder.html
/VoiceRecorder/voicerecorder.js
/VoiceRecorder/mic-indicator/mic-indicator.js
/VoiceRecorder/mic-indicator/mic-indicator.css


2. Подключите стили в `<head>` (путь относительно HTML):
```html
<link rel="stylesheet" href="voicerecorder/mic-indicator/mic-indicator.css">


Создайте контейнер там, где хотите видеть индикатор:

<div id="vc-level" style="max-width:2600px; min-width:120px;"></div>


Контейнер управляет видимым размером индикатора — так он будет корректно выглядеть в любом месте интерфейса.

Инициализация (без автоподключения):

<script type="module">
  import MicIndicator from './voicerecorder/mic-indicator/mic-indicator.js';
  // создать экземпляр, но не подключать stream
  const indicator = new MicIndicator(document.getElementById('vc-level'), {/*options*/});
  window._SV_MIC_INDICATOR = indicator;
</script>


Подключение потока — только при старте записи:

// внутри вашей функции startRecording(), после получения mediaStream:
const indicator = window._SV_MIC_INDICATOR || new MicIndicator(document.getElementById('vc-level'), {/*options*/});
indicator.connectStream(mediaStream);


Отключение:

indicator.disconnect(); // остановить визуализацию (DOM сохраняется)
indicator.destroy();    // удалить DOM и освободить ресурсы

API (кратко)

new MicIndicator(containerElement, opts) — создаёт виджет. Не подключает аудио автоматически.

await indicator.connectStream(mediaStream) — подключает существующий MediaStream.

indicator.disconnect(), indicator.destroy(), indicator.setSimLevel(v) — доступны.

Опции: stepMs, sensitivity, minVisible, barWidthPx, gapPx.

CSS-переменные (переопределяйте в локальном CSS)

--svmic-height — высота (например 14mm)

--svmic-bar-color, --svmic-baseline-color

--svmic-gap-px, --svmic-bar-width-px, --svmic-padding-px

Производительность

Компонент использует AnalyserNode (или значения, если вы шлёте RMS из AudioWorklet).

Рекомендуется использовать единственный AudioContext / MediaStream в приложении и передавать stream в connectStream().

Отладка / тесты

В консоли: indicator.setSimLevel(0.8) — будет видно палочки.

Если видите точку до старта: убедитесь, что connectStream() не вызывается при загрузке.