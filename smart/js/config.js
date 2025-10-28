// Static site CONFIG (simple)
export const CONFIG = {
  BASE_URL: "/",
  VERSION: "4.0.0",
  PROJECT_NAME: "Smart Vision (static)",
  DEFAULT_PAGE: "home",
  PAGES: [
    { id: "home", label: "Главная" },
    { id: "about", label: "О нас" },
    { id: "contacts", label: "Контакты" },
    { id: "policy", label: "Политика конфиденциальности" },
    { id: "terms", label: "Условия использования" },
    { id: "dashboard", label: "Личный кабинет" },
    // модули — относительные к папке /modules/
    { id: "context", label: "🎧 Context Audio", module: "context/index.js" },
    { id: "translator", label: "🗣️ Переводчик", module: "translator/index.js" }
  ]
};

// для удобства — ставим в window (необязательно)
window.SV_CONFIG = CONFIG;
