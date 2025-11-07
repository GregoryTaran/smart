Mic Indicator (UI)

Лёгкий визуальный индикатор уровня микрофона на Web Audio API. Компонент полностью визуальный: принимает MediaStream, рисует «бегущие бары», имеет состояния initial / working / pause, не эмитит события наружу. 

mic-indicator

Состав
mic-indicator/
├─ mic-indicator.js   # логика и рендер (Canvas), состояния, расчёт RMS/PEAK
└─ mic-indicator.css  # стили (толщина полос, отступы, цвета, тёмная тема)


В CSS по умолчанию «толщина» бара уменьшена до 3px, «gap» — 2px (см. CSS-переменные ниже). 

mic-indicator

Быстрый старт
HTML
<div class="mic-box">
  <div id="vc-level"></div>
</div>

<link rel="stylesheet" href="./mic-indicator.css">
<script type="module">
  import MicIndicator from './mic-indicator.js';

  // Пример инициализации (см. JS ниже)
</script>

JavaScript
import MicIndicator from './mic-indicator.js';

// Контейнер — это DOM-элемент, внутри которого компонент сам создаст canvas
const container = document.getElementById('vc-level');
const mic = new MicIndicator(container, {
  // опциональные параметры (см. «Опции»)
  analyserSmoothing: 0.2,
  fftSize: 1024,
  stepMs: 100,
});

// Подключаем аудио-поток (например, после init вашего аудио-ядра)
await mic.connectStream(mediaStream);

// Пауза/возврат/остановка
// mic.setInactive();   // принудительно отрисовать baseline
// mic.disconnect();    // отцепить поток и вернуться в initial
// mic.destroy();       // убрать слушатели/DOM и очиститься


Компонент сам создаёт внутренние элементы (.sv-mic-indicator / canvas) и управляет размерами при ресайзе окна. 

mic-indicator

Опции (конструктор)
new MicIndicator(container, {
  stepMs: 100,            // период выборки и обновления буфера
  fftSize: 1024,          // размер окна анализатора (time-domain)
  analyserSmoothing: 0.2, // сглаживание AnalyserNode (0..1)
  sensitivity: 5,         // чувствительность визуализации
  exponent: 0.95,         // экспонента для RMS
  minVisible: 0.01,       // минимальная видимая высота баров
  minBars: 6,             // минимальное число баров
  peakMultiplier: 5,      // множитель «пиков» (всплески)
  peakDecay: 0.98,        // затухание пика
  bufDecay: 1,            // резерв на «буферный» спад (оставлено для совместимости)
  barWidthPx: null,       // задать ширину бара в JS (иначе берётся из CSS var)
  gapPx: null,            // задать gap в JS (иначе из CSS var)
  silenceThreshold: 0.02, // порог тишины (нормированный уровень)
  silenceTimeoutMs: 5000  // длительность тишины для перехода в state=pause
});


Глобально обновить дефолты можно через MicIndicator.setDefaults({...}). 

mic-indicator

Методы
await mic.connectStream(mediaStream) // подключает MediaStream, создаёт AudioContext/Analyser
mic.disconnect()                     // отцепляет поток, возвращает state='initial'
mic.setInactive()                    // сбрасывает буфер, рисует baseline (без движения)
mic.setSimLevel(value01)             // тестовый метод: руками «кормить» уровень (0..1)
mic.destroy()                        // снимает listeners, удаляет DOM, помечает как уничтоженный


Компонент не управляет вашим AudioContext и не сохраняет WAV — это чистая визуализация. 

mic-indicator

Стили и кастомизация (CSS Variables)

В корневом элементе индикатора можно настраивать параметры через CSS-переменные:

.sv-mic-indicator{
  --svmic-padding-px: 0;
  --svmic-bar-width-px: 3;  /* ширина одной полосы */
  --svmic-gap-px: 2;        /* расстояние между полосами */
  --svmic-baseline-color: #e6e8eb;
  --svmic-bar-color: #151515;
  --svmic-min-visible: 0.01;
}


Контейнер .mic-box задаёт рамку, фон, тени, размеры. Есть стили для тёмной темы и high-contrast. 

mic-indicator

Логика состояний

initial — нет данных/стрима, рисуется только baseline (горизонтальная линия).

working — пришёл уровень выше silenceThreshold, рисуются «бары».

pause — длительная тишина (silenceTimeoutMs) после работы: фиксируется последний кадр (анимация останавливается). 

mic-indicator

Лучшие практики

Подключайте индикатор к «обработанному» потоку — т.е. к тому же MediaStream, который идёт на запись (после вашего GainNode). Тогда картинка соответствует фактическому уровню записи.

Для более «живого» разлёта баров:

снижайте analyserSmoothing (пример: 0.15–0.25);

увеличивайте sensitivity или peakMultiplier чуть-чуть;

регулируйте --svmic-bar-width-px / --svmic-gap-px в CSS. 

mic-indicator

 

mic-indicator

Отладка

Если ничего не рисуется: проверьте, что передаёте валидный MediaStream и что в нём есть аудио-трек. connectStream() бросит ошибку при некорректном потоке. 

mic-indicator

Если полоса «замерла»: возможно, компонент в pause — проверьте silenceThreshold и silenceTimeoutMs.

На мобильных убедитесь, что сайт открыт по HTTPS (иначе доступ к микрофону может быть заблокирован).