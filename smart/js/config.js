// ======== Smart Vision CONFIG (v2.3 — добавлен модуль Translator) ========

export const CONFIG = {
  BASE_URL: "https://test.smartvision.life/",
  VERSION: "2.3.0",
  PROJECT_NAME: "Smart Vision Design",

  // Основные страницы
  PAGES: [
    { id: "home", label: "Главная" },
    { id: "policy", label: "Политика конфиденциальности" },
    { id: "terms", label: "Условия использования" },
    { id: "about", label: "О нас" },
    { id: "contacts", label: "Контакты" },
    { id: "dashboard", label: "Личный кабинет" },

    // 🎧 Context — старый модуль
    { id: "context", label: "🎧 Context Audio", module: "context" },

    // 🗣️ Translator — новый модуль "Переводчик-Суфлёр"
    { id: "translator", label: "🗣️ Переводчик-Суфлёр", module: "translator" }
  ]
};
