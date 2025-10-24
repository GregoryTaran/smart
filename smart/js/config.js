// ======== Smart Vision CONFIG (v2.2 — добавлен модуль для Context) ========

export const CONFIG = {
  BASE_URL: "https://test.smartvision.life/",
  VERSION: "2.2.0",
  PROJECT_NAME: "Smart Vision Design",

  // Основные страницы
  PAGES: [
    { id: "home", label: "Главная" },
    { id: "policy", label: "Политика конфиденциальности" },
    { id: "terms", label: "Условия использования" },
    { id: "about", label: "О нас" },
    { id: "contacts", label: "Контакты" },
    { id: "dashboard", label: "Личный кабинет" },

    // ✅ ДОБАВЛЕНО: страница Context подключается как модуль из папки /context/
    { id: "context", label: "🎧 Context Audio", module: "context" }
  ]
};
