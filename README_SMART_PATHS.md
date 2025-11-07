# SMART Vision — Гайд по путям, фрагментам и Service Worker
_Один стандарт, который стабильно работает локально и на сервере._

## Коротко (TL;DR)
- На страницах, лежащих **в подпапках** (например, `voicerecorder/voicerecorder.html`), в `<head>` ставим:
  ```html
  <base href="../">
  ```
- **Все URL в этой странице и её JS — относительные** (без ведущего `/`):
  - `css/main.css`, `js/fragment-load.js`, `menu.html`, `voicerecorder/voicerecorder.js`, …
- `fragment-load.js` грузит фрагменты **относительно `document.baseURI`** (то есть просто `"menu.html"`, `"topbar.html"`, `"footer.html"`).
- `register-sw.js` строит путь к SW **относительно `document.baseURI`** (см. код ниже).
- В `sv-audio-core.js` путь к worklet — **относительный**: `voicerecorder/audiocore/recorder.worklet.js` (без `/`).

Так локально (где базовый путь страницы `.../smart/`) и на проде (где базовый путь `/`) всё резолвится корректно — **без переписывания путей**.

---

## 1) Стандарт для HTML-страницы

### 1.1. Страница в подпапке
Пример: `smart/voicerecorder/voicerecorder.html`

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="../" />

  <title>Диктофон</title>
  <link rel="icon" href="assets/logo400.jpg" />
  <link rel="manifest" href="manifest.json" />

  <!-- Общие стили -->
  <link rel="stylesheet" href="css/main.css" />

  <!-- Стили фичи -->
  <link rel="stylesheet" href="voicerecorder/mic-indicator/mic-indicator.css" />
  <link rel="stylesheet" href="voicerecorder/voicerecorder.css" />
</head>
<body>
  <div id="page">
    <aside id="sidebar" aria-label="Основное меню"></aside>
    <div id="app">
      <header id="topbar" role="banner"></header>
      <main id="main" role="main">
        <!-- Основной контент фичи -->
      </main>
      <footer id="footer" role="contentinfo"></footer>
    </div>
  </div>
  <div id="overlay" hidden></div>

  <!-- Загрузчик фрагментов (меню/хедер/футер) -->
  <script defer src="js/fragment-load.js"></script>

  <!-- Логика фичи -->
  <script defer type="module" src="voicerecorder/voicerecorder.js"></script>

  <!-- Регистрация Service Worker -->
  <script defer src="js/register-sw.js"></script>
</body>
</html>
```

### 1.2. Страница в корне (редко)
Если страница лежит прямо в `smart/` (в корне фронта), можно явно указать:
```html
<base href="./">
```
и **тоже** писать относительными путями (`css/main.css`, `js/...`, …).

---

## 2) Фрагменты (меню/хедер/футер)

В `js/fragment-load.js` пути — **относительные** (чтобы `<base>` работал за нас):
```js
// Правильно (универсально):
loadFragment("menu.html",   "#sidebar");
loadFragment("topbar.html", "#topbar");
loadFragment("footer.html", "#footer");

// Плохо (ломается на страницах из подпапок):
// loadFragment("/menu.html",   "#sidebar");
// loadFragment("/topbar.html", "#topbar");
// loadFragment("/footer.html", "#footer");
```

> Итог: на локали получится `.../smart/menu.html`, на проде — `/menu.html`. Один код → два окружения.

---

## 3) Service Worker (универсальная регистрация)

Не «зашивайте» абсолютные пути. Регистрируйте SW относительно базы текущей страницы:

```js
// js/register-sw.js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      // Путь к SW от base (работает и в корне, и в подпапке)
      const swUrl   = new URL('service-worker.js', document.baseURI).href;
      // Скоуп = базовый путь страницы ('/smart/' на локали, '/' на проде)
      const swScope = new URL('./', document.baseURI).pathname;

      navigator.serviceWorker.register(swUrl, { scope: swScope })
        .catch(err => console.warn('SW register failed:', err));
    } catch (e) {
      console.warn('SW register exception:', e);
    }
  });
}
```

### 3.1. Обновление кэша
При изменении путей увеличивайте версию кэша в `service-worker.js`:
```js
const CACHE_NAME = 'SV_CACHE_v3'; // bump v2 -> v3 и т.д.
```
И делайте **Hard Refresh** (Ctrl/Cmd + F5) после деплоя.

---

## 4) AudioWorklet / WebAudio

В `voicerecorder/audiocore/sv-audio-core.js`:

```js
// Дефолт — относительно base (универсально)
this._workletUrl = options.workletUrl
  || 'voicerecorder/audiocore/recorder.worklet.js';

// ...
// и потом:
await this._audioCtx.audioWorklet.addModule(this._workletUrl);
```

> Почему так: `<base>` влияет на резолвинг URL ворклета. Если поставить ведущий `/`, локально URL уйдёт в `http://127.0.0.1:5500/voicerecorder/...` (мимо). Относительный путь стабильно даёт `.../smart/voicerecorder/...` локально и `/voicerecorder/...` на проде.

---

## 5) Меню и ссылки

В `menu.html` (и везде по сайту) ссылку на диктофон делаем **в терминах базы**. Либо:
```html
<!-- Универсально, если страница-носитель в подпапке и имеет <base href="../"> -->
<a href="voicerecorder/voicerecorder.html" data-id="voicerecorder">Диктофон</a>
```
Либо, если меню всегда вставляется в страницы из **корня** (base = "/"), можно корневой путь `/voicerecorder/voicerecorder.html`. Но «универсальный» вариант с относительным путём безопаснее при смешанных сценариях.

---

## 6) Чувствительность к регистру (важно для прод)
На проде (Linux) имена файлов **чувствительны к регистру**. Проверьте точное совпадение:
- `voicerecorder/mic-indicator/mic-indicator.css` (а не `Mic-indicator.css`)
- `voicerecorder/voicerecorder.css` и т.д.

---

## 7) Чек-лист перед деплоем

1. Страница фичи в подпапке имеет `<base href="../">`.
2. Все пути внутри страницы и её JS — **без ведущего** `/`.
3. `fragment-load.js` — relative (`"menu.html"`, `"topbar.html"`, `"footer.html"`).
4. `register-sw.js` — регистрация через `new URL(..., document.baseURI)`.
5. `sv-audio-core.js` — worklet по относительному пути.
6. В DevTools → **Network**:
   - `css/main.css`, `voicerecorder/*.css`, `js/*.js` — 200/304;
   - `menu.html`, `topbar.html`, `footer.html` — 200/304;
   - `service-worker.js` — регистрируется без 404.
7. Если меняли пути — bump версии кэша SW + Hard Refresh.

---

## 8) Типовой шаблон новой фичи

```
smart/
  css/
  js/
  menu.html
  topbar.html
  footer.html
  featureX/
    featureX.html       <-- имеет <base href="../">
    featureX.css
    featureX.js
```

**featureX.html** (скелет):
```html
<base href="../">
<link rel="stylesheet" href="css/main.css">
<link rel="stylesheet" href="featureX/featureX.css">
<script defer src="js/fragment-load.js"></script>
<script defer type="module" src="featureX/featureX.js"></script>
<script defer src="js/register-sw.js"></script>
```

Ссылки в меню: `href="featureX/featureX.html"`.

---

## 9) Отладка «почему 404?»
- В консоли: `document.baseURI` и `<base>` → должны указывать на корректный базовый путь.
- Проверьте точные URL, которые создаёт браузер:
  ```js
  new URL('css/main.css', document.baseURI).href
  new URL('menu.html',   document.baseURI).href
  new URL('service-worker.js', document.baseURI).href
  ```
- Отключите кэш DevTools и временно Unregister SW.
- Проверьте прямым заходом по URL, например: `/voicerecorder/voicerecorder.css`.

---

## 10) Про Render
- `render.yaml` описывает **бэкенд** и не влияет на резолвинг путей фронтенда.
- Для статического фронта (CDN) правила те же — `<base>` и относительные пути решают.
- При необходимости правила SPA/rewrites настраиваются в панели хостинга (это вне кода).

---

## Вопросы/правки
Если добавляется новый раздел или меняется структура — придерживаемся этого стандарта. Если где-то нужно отойти (например, особый скоуп SW) — пишем в этот README раздел «Исключения».
