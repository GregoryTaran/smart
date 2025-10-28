// js/config.js
// Site-level config for SMART VISION frontend loader.
// Place this file in the web root under "js/" and include it *before* index.js:
// <script src="/js/config.js"></script>
// <script type="module" src="/index.js"></script>

window.CONFIG = {
  // Если используешь нестандартный базовый путь, укажи его, иначе пустая строка -> корень "/"
  BASE_URL: "",

  // Версия для busting cache — увеличивай при деплое
  VERSION: "2025-10-28-v1",

  // ID контейнера куда рендерится SPA (должен быть в index.html)
  MOUNT_ID: "app",

  // Карта страниц: id -> { id, module, title }
  // module — путь относительно корня сайта; loader запрашивает "/<module>?v=VERSION"
  PAGES: {
    // Главное меню (fallback). menu1.js у тебя уже есть.
    "menu":      { id: "menu",      module: "menu1.js",                     title: "Menu" },

    // Контекст (аудио -> whisper -> gpt -> tts) — подстраивай путь, если положишь иначе
    "context":   { id: "context",   module: "context/context.js",           title: "Context" },

    // Переводчик
    "translate": { id: "translate", module: "translator/translator.js",     title: "Translator" }
  },

  // НЕ КЛАДИ ГЛОБАЛЬНЫЕ ПАРАМЕТРЫ ЧАНКОВ ЗДЕСЬ — каждый модуль сам решает, как отправлять чанки.
  // Это deliberate design choice по твоему запросу.

  // Доп. опции (необязательно)
  UI: {
    showDebugInfo: false
  }
};
