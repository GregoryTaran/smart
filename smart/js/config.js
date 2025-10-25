// ======== Smart Vision CONFIG (v3.0 — явные пути модулей) ========

export const CONFIG = {
  BASE_URL: "https://test.smartvision.life/",
  VERSION: "3.0.0",
  PROJECT_NAME: "Smart Vision Design",

  PAGES: [
    { id: "home", label: "Главная" },
    { id: "policy", label: "Политика конфиденциальности" },
    { id: "terms", label: "Условия использования" },
    { id: "about", label: "О нас" },
    { id: "contacts", label: "Контакты" },
    { id: "dashboard", label: "Личный кабинет" },

    // 🎧 Context
    { id: "context", label: "🎧 Context Audio", module: "context/module.js" },

    // 🗣️ Translator
    { id: "translator", label: "🗣️ Переводчик-Суфлёр", module: "translator/translator.js" }
  ]
};
