// js/config.js
// Проектный статический CONFIG — тут перечисляем страницы и, при возможности, пути к модулям.
// Комментарии:
// - module: строка с относительным путем к модулю относительно корня сайта (рекомендуемый)
// - loader в index.js будет пробовать несколько форм резолвинга (включая абсолютные `/translator/index.js`)
export const CONFIG = {
  BASE_URL: "/",                     // базовый URL (для будущих построений)
  VERSION: "2025.10.28",             // версия конфигурации
  PROJECT_NAME: "Smart Vision (static)",
  DEFAULT_PAGE: "home",              // страница по умолчанию
  // Список страниц. Поля: id (hash), label (название меню), module (опционально — путь к модулю)
  PAGES: [
    { id: "home", label: "Главная" },
    { id: "about", label: "О нас" },
    { id: "contacts", label: "Контакты" },
    { id: "policy", label: "Политика конфиденциальности" },
    { id: "terms", label: "Условия использования" },
    { id: "dashboard", label: "Личный кабинет" },

    // Модули — указаны как <folder>/index.js (наш загрузчик будет пробовать корневые абсолютные пути)
    // У тебя модуль translator лежит в /translator/index.js (в корне smart/translator)
    { id: "translator", label: "Переводчик", module: "translator/index.js" },

    // Модуль context (в корне smart/context/index.js)
    { id: "context", label: "Context Audio", module: "context/index.js" }
  ]
};

// Для удобства и обратной совместимости — кладём в window
window.SV_CONFIG = CONFIG;
