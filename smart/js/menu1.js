// ======== Smart Vision /design — Меню (v2) ========

import { CONFIG } from "./config.js";

export function renderMenu(activePage = "home", user = null) {
  const { PAGES } = CONFIG;
  const menuItems = PAGES
    .filter(p => (user ? true : p.id !== "dashboard")) // скрываем кабинет, если не вошёл
    .map(
      p => `
      <li>
        <a href="#${p.id}" data-page="${p.id}" class="${p.id === activePage ? "active" : ""}">
          ${p.label}
        </a>
      </li>`
    )
    .join("");

  return `
    <div class="menu-header">
      <span class="menu-title">МЕНЮ</span>
      <button id="menu-close" class="menu-close" aria-label="Закрыть меню">←</button>
    </div>
    <ul class="menu-list">${menuItems}</ul>
  `;
}
