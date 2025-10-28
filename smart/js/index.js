// js/index.js
import { CONFIG } from "./config.js";

/*
  Unified index.js — версия с устойчивым попыточным импортом модулей.
  Каждый важный блок подробно прокомментирован (как просил).
*/

const STATE = {
  env: window.innerWidth <= 768 ? "mobile" : "desktop",
  page: CONFIG.DEFAULT_PAGE || (CONFIG.PAGES && CONFIG.PAGES[0] && CONFIG.PAGES[0].id) || "home",
  ui: { menuOpen: false },
  currentModuleRef: null,
  currentModulePath: null
};

const E = {}; // dom refs

document.addEventListener("DOMContentLoaded", () => {
  // Кешируем DOM-узлы
  E.menu = document.getElementById("side-menu");
  E.header = document.getElementById("site-header");
  E.main = document.getElementById("content");
  E.footer = document.getElementById("site-footer");
  E.overlay = document.getElementById("overlay");
  E.wrapper = document.getElementById("wrapper");

  document.body.dataset.env = STATE.env;
  renderShell();      // собираем header/menu/footer
  attachGlobalEvents(); // навешиваем слушатели
  setPageFromHash();  // рендерим страницу по хэшу
  document.body.classList.remove("preload");
});

/* --------------------------
   Shell (header, menu, footer)
   -------------------------- */
function renderShell() {
  renderHeader();
  renderMenu();
  renderFooter();
}

function renderHeader() {
  E.header.innerHTML = `
    <button id="menu-toggle" aria-controls="side-menu" aria-expanded="false" aria-label="Открыть меню">☰</button>
    <div id="logo-wrap"><img id="site-logo" src="assets/logo400.jpg" alt="${escapeHtml(CONFIG.PROJECT_NAME)}"></div>
  `;
  const toggle = E.header.querySelector("#menu-toggle");
  toggle.addEventListener("click", () => {
    toggleMenu();
  });
}

function renderMenu() {
  const pages = Array.isArray(CONFIG.PAGES) ? CONFIG.PAGES : [];
  const list = document.createElement("ul");
  list.className = "menu-list";

  for (const p of pages) {
    if (!p.id || !p.label) continue;
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${p.id}`;
    a.dataset.page = p.id;
    a.textContent = p.label;
    a.setAttribute("role", "link");
    a.className = p.id === STATE.page ? "active" : "";
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      navigateTo(p.id);
    });
    li.appendChild(a);
    list.appendChild(li);
  }

  const menuHeader = document.createElement("div");
  menuHeader.className = "menu-header";
  menuHeader.innerHTML = `
    <span class="menu-title">МЕНЮ</span>
    <button id="menu-close" class="menu-close" aria-label="Закрыть меню">✕</button>
  `;

  E.menu.innerHTML = "";
  E.menu.appendChild(menuHeader);
  E.menu.appendChild(list);

  const closeBtn = E.menu.querySelector("#menu-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeMenu());
}

/* Footer */
function renderFooter() {
  E.footer.innerHTML = `
    <div class="footer-links">
      <a href="#policy">Политика</a> · <a href="#terms">Условия</a>
    </div>
    <div class="footer-meta">© ${new Date().getFullYear()} ${escapeHtml(CONFIG.PROJECT_NAME)}</div>
  `;
}

/* --------------------------
   Menu controls + accessibility (focus trap, Esc)
   -------------------------- */
function toggleMenu() {
  if (STATE.ui.menuOpen) closeMenu();
  else openMenu();
}

function openMenu() {
  STATE.ui.menuOpen = true;
  document.body.classList.add("menu-open");
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  E.overlay.setAttribute("aria-hidden", "false");
  // фокус в первое интерактивное в меню
  setTimeout(() => {
    const first = E.menu.querySelector("a, button");
    if (first) first.focus();
  }, 10);
  document.addEventListener("keydown", handleMenuKeydown);
}

function closeMenu() {
  STATE.ui.menuOpen = false;
  document.body.classList.remove("menu-open");
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  E.overlay.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", handleMenuKeydown);
  // возвращаем фокус к кнопке меню
  if (toggle) toggle.focus();
}

function handleMenuKeydown(e) {
  if (!STATE.ui.menuOpen) return;
  if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
  if (e.key === "Tab") {
    const focusables = Array.from(E.menu.querySelectorAll("a,button")).filter(Boolean);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}

/* --------------------------
   Router + устойчивый загрузчик модулей
   -------------------------- */
function attachGlobalEvents() {
  window.addEventListener("hashchange", setPageFromHash);
  window.addEventListener("resize", onResize);
  E.overlay.addEventListener("click", () => closeMenu());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && STATE.ui.menuOpen) closeMenu();
  });
}

function onResize() {
  const newEnv = window.innerWidth <= 768 ? "mobile" : "desktop";
  if (newEnv !== STATE.env) {
    STATE.env = newEnv;
    document.body.dataset.env = STATE.env;
    if (STATE.env === "desktop") openMenu();
    else closeMenu();
  }
}

function setPageFromHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  const page = raw || CONFIG.DEFAULT_PAGE || STATE.page;
  if (page !== STATE.page) { navigateTo(page); }
  else { updateMenuActive(page); }
  if (STATE.env === "mobile") closeMenu();
}

async function navigateTo(pageId) {
  const pageCfg = (CONFIG.PAGES || []).find(p => p.id === pageId);
  if (!pageCfg) {
    renderStatic("notfound");
    updateMenuActive(null);
    STATE.page = "notfound";
    return;
  }

  // Вызов unload если есть
  if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
    try { await STATE.currentModuleRef.unload(); } catch (e) { console.warn("module.unload error:", e); }
  }
  STATE.currentModuleRef = null;
  STATE.currentModulePath = null;

  STATE.page = pageId;
  if ((window.location.hash || "").replace(/^#/, "") !== pageId) window.location.hash = pageId;
  updateMenuActive(pageId);

  if (pageCfg.module) {
    // Загрузить модуль, пробуя несколько путей (корень, /modules, /js/modules и т.д.)
    E.main.innerHTML = `<section class="main-block"><div id="module-root" class="module-root">Загрузка...</div></section>`;
    const mount = document.getElementById("module-root");
    await loadModuleWithFallbacks(pageCfg.module, mount);
  } else {
    renderStatic(pageId);
  }
  if (STATE.env === "mobile") closeMenu();
}

function updateMenuActive(pageId) {
  const links = E.menu.querySelectorAll("a[data-page]");
  links.forEach(a => a.classList.toggle("active", a.dataset.page === pageId));
}

/* --------------------------
   Устойчивый загрузчик: пытаем несколько candidate путей
   Возвращает reference модуля, либо показывает ошибку с перечнем попыток
   -------------------------- */
async function loadModuleWithFallbacks(modulePathFromConfig, mountEl) {
  // candidatePaths: порядок важен — сначала корень ("/..."), потом /modules, потом /js/modules, потом относительные.
  // Это покрывает большинство возможных раскладок (по твоей структуре модули могут лежать в корне smart/<mod>/..., или в js/modules, или modules)
  const normalized = String(modulePathFromConfig).replace(/^\.\/+/, ""); // убираем ведущие ./ если есть
  const candidates = [
    `/${normalized}`,                       // /context/index.js  или /translator/index.js
    `/${normalized.replace(/index\.js$/, "")}index.js`, // на случай если в конфиг дали папку
    `/modules/${normalized}`,               // /modules/context/index.js
    `/js/modules/${normalized}`,            // /js/modules/context/index.js
    `./modules/${normalized}`,              // относительно /js
    `./${normalized}`                       // относительный к js/index.js
  ];

  // убираем дубли
  const seen = new Set();
  const candidateList = candidates.filter(p => {
    if (!p) return false;
    if (seen.has(p)) return false;
    seen.add(p); return true;
  });

  let lastError = null;
  const tried = [];
  for (const c of candidateList) {
    tried.push(c);
    try {
      // динамический import; он бросит если 404 или синтаксическая ошибка
      const mod = await import(c);
      // Успех — запоминаем модуль и вызываем render
      STATE.currentModuleRef = mod;
      STATE.currentModulePath = c;
      if (typeof mod.render === "function") {
        await mod.render(mountEl, { CONFIG, STATE });
      } else {
        mountEl.innerHTML = `<div class="module-error">Модуль загружен из ${escapeHtml(c)}, но не содержит render()</div>`;
      }
      return; // успех — выходим
    } catch (err) {
      // сохраняем ошибку и пробуем следующий путь
      console.warn("module import failed for", c, err && err.message);
      lastError = err;
      // продолжаем цикл
    }
  }

  // если дошли сюда — все попытки упали — показываем дружелюбную ошибку и список путей, которые пробовали
  console.error("Все попытки импорта модуля неуспешны. Попытки:", tried, lastError);
  mountEl.innerHTML = `
    <div class="module-error">
      Ошибка загрузки модуля. Пробованные пути:<br/><pre>${escapeHtml(tried.join("\n"))}</pre>
      <div>Ошибка: ${escapeHtml(String(lastError && lastError.message || lastError))}</div>
      <div style="margin-top:10px;"><button id="module-retry">Попробовать снова</button></div>
    </div>
  `;
  const retry = document.getElementById("module-retry");
  if (retry) retry.addEventListener("click", () => loadModuleWithFallbacks(modulePathFromConfig, mountEl));
}

/* --------------------------
   Статические шаблоны (fallback)
   -------------------------- */
function renderStatic(id) {
  const templates = {
    home: `<section class="main-block"><h2>Главная</h2><p>Добро пожаловать в Smart Vision.</p></section>`,
    about: `<section class="main-block"><h2>О нас</h2><p>Smart Vision — проект.</p></section>`,
    contacts: `<section class="main-block"><h2>Контакты</h2><p><a href="mailto:info@smartvision.life">info@smartvision.life</a></p></section>`,
    policy: `<section class="main-block"><h2>Политика</h2><p>...</p></section>`,
    terms: `<section class="main-block"><h2>Условия</h2><p>...</p></section>`,
    notfound: `<section class="main-block"><h2>Страница не найдена</h2><p>Кажется, такой страницы нет.</p></section>`
  };
  E.main.innerHTML = templates[id] || templates.notfound;
}

/* --------------------------
   Utilities
   -------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
