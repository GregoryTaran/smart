// js/index.js
// Unified index.js — управляющий модулем клиента.
// Исправления в этой версии:
// - initial navigate: при загрузке сразу рендерим default страницу (если нет hash).
// - устойчивый загрузчик модулей: пробует абсолютные URL (new URL(candidate, origin).href) и несколько кандидатных путей.
// - логотип кликабелен и ведёт на корень сайта (https://test.smartvision.life/).
// - корректный обработчик "крестика" меню, overlay, z-index правки.
// - подробные комментарии по каждому важному блоку.

import { CONFIG } from "./config.js";

/* ----------------------
   Application state
   ---------------------- */
const STATE = {
  env: window.innerWidth <= 768 ? "mobile" : "desktop",  // 'mobile' или 'desktop'
  page: CONFIG.DEFAULT_PAGE || (CONFIG.PAGES && CONFIG.PAGES[0] && CONFIG.PAGES[0].id) || "home",
  ui: { menuOpen: false },
  currentModuleRef: null,     // ссылка на загруженный модуль (export object)
  currentModulePath: null     // путь, с которого модуль был загружен
};

/* ----------------------
   DOM references cache
   ---------------------- */
const E = {
  menu: null,
  header: null,
  main: null,
  footer: null,
  overlay: null,
  wrapper: null
};

/* ----------------------
   Init on DOM ready
   ---------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // Cache DOM nodes (везде предполагаем, что элементы есть в index.html)
  E.menu = document.getElementById("side-menu");
  E.header = document.getElementById("site-header");
  E.main = document.getElementById("content");
  E.footer = document.getElementById("site-footer");
  E.overlay = document.getElementById("overlay");
  E.wrapper = document.getElementById("wrapper");

  // пометить окружение
  document.body.dataset.env = STATE.env;

  // собрать shell (header/menu/footer)
  renderShell();

  // навесить глобальные слушатели (resize/hashchange/overlay)
  attachGlobalEvents();

  // если есть hash — отработаем его, иначе инициируем initial navigate к DEFAULT_PAGE
  const rawHash = (window.location.hash || "").replace(/^#\/?/, "");
  if (rawHash) {
    // если хэш есть — отрисовать соответствующую страницу
    setPageFromHash();
  } else {
    // если нет хэша — рендерим default страницу сразу (гарантируем initial render)
    // используем navigateTo чтобы гарантировать вызов unload() у предыдущих модулей
    navigateTo(STATE.page).catch(err => console.error("initial navigate error", err));
  }

  // выключаем preload-класс (если есть)
  document.body.classList.remove("preload");
});

/* ----------------------
   Shell rendering (header, menu, footer)
   ---------------------- */
function renderShell() {
  renderHeader();
  renderMenu();
  renderFooter();
}

/* Header: логотип (кликабельный), кнопка меню */
function renderHeader() {
  // логика: логотип кликает на корень; перед переходом пытаемся вызвать unload() у текущего модуля
  E.header.innerHTML = `
    <button id="menu-toggle" aria-controls="side-menu" aria-expanded="false" aria-label="Открыть меню">☰</button>
    <div id="logo-wrap" role="link" title="${escapeHtml(CONFIG.PROJECT_NAME)}" tabindex="0" style="display:flex;align-items:center;">
      <img id="site-logo" src="assets/logo400.jpg" alt="${escapeHtml(CONFIG.PROJECT_NAME)}" />
    </div>
  `;

  // menu toggle (кнопка)
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.addEventListener("click", () => toggleMenu());

  // logo click: сначала пытаемся аккуратно выгрузить модуль, затем навигация на корень сайта
  const logoWrap = E.header.querySelector("#logo-wrap");
  if (logoWrap) {
    // обработчик клика (мышь)
    logoWrap.addEventListener("click", async (ev) => {
      ev.preventDefault();
      // попробуем вызвать unload у текущего модуля (фолбек — просто продолжаем)
      if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
        try { await STATE.currentModuleRef.unload(); } catch (err) { console.warn("module.unload failed on logo click", err); }
      }
      // если меню открыто — закроем
      if (STATE.ui.menuOpen) closeMenu();
      // Перейти на корень сайта (строго по твоему желанию)
      // Используем полную перезагрузку, чтобы URL стал точно: https://test.smartvision.life/
      window.location.href = `${location.origin}/`;
    });

    // поддержка клавиатуры (Enter / Space)
    logoWrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        logoWrap.click();
      }
    });
  }
}

/* Menu: строим список из CONFIG.PAGES */
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
    // если текущая страница — пометить active
    a.className = p.id === STATE.page ? "active" : "";
    // навигация при клике
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      // если уже на той странице — просто закроем меню (мобильное)
      if (p.id === STATE.page) {
        if (STATE.env === "mobile") closeMenu();
        return;
      }
      navigateTo(p.id).catch(err => console.error("navigateTo error", err));
    });
    li.appendChild(a);
    list.appendChild(li);
  }

  // header меню: заголовок и крестик закрытия (кнопка)
  const menuHeader = document.createElement("div");
  menuHeader.className = "menu-header";
  menuHeader.innerHTML = `
    <span class="menu-title">МЕНЮ</span>
    <button id="menu-close" class="menu-close" aria-label="Закрыть меню">✕</button>
  `;

  // вставляем в DOM
  E.menu.innerHTML = "";
  E.menu.appendChild(menuHeader);
  E.menu.appendChild(list);

  // Вешаем обработчик закрытия сразу после добавления в DOM (чтобы он точно работал)
  const closeBtn = E.menu.querySelector("#menu-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeMenu());
  }
}

/* Footer: простая информация */
function renderFooter() {
  E.footer.innerHTML = `
    <div class="footer-links">
      <a href="#policy">Политика</a> · <a href="#terms">Условия</a>
    </div>
    <div class="footer-meta">© ${new Date().getFullYear()} ${escapeHtml(CONFIG.PROJECT_NAME)}</div>
  `;
}

/* ----------------------
   Menu controls (open/close + focus trap)
   ---------------------- */
function toggleMenu() {
  if (STATE.ui.menuOpen) closeMenu(); else openMenu();
}

function openMenu() {
  STATE.ui.menuOpen = true;
  document.body.classList.add("menu-open");
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  E.overlay.setAttribute("aria-hidden", "false");
  // фокусируем первое интерактивное в меню
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
  // вернуть фокус к toggle
  const toggleBtn = E.header.querySelector("#menu-toggle");
  if (toggleBtn) toggleBtn.focus();
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

/* ----------------------
   Router & navigation
   ---------------------- */
function attachGlobalEvents() {
  window.addEventListener("hashchange", setPageFromHash);
  window.addEventListener("resize", onResize);
  // overlay закрывает меню по клику
  if (E.overlay) E.overlay.addEventListener("click", () => closeMenu());
  // глобальный Esc: если меню открыто — закрыть
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && STATE.ui.menuOpen) closeMenu();
  });
}

function onResize() {
  const newEnv = window.innerWidth <= 768 ? "mobile" : "desktop";
  if (newEnv !== STATE.env) {
    STATE.env = newEnv;
    document.body.dataset.env = STATE.env;
    if (STATE.env === "desktop") {
      // на десктопе меню всегда открыто визуально
      document.body.classList.add("menu-open");
      STATE.ui.menuOpen = true;
    } else {
      // на мобиле — по умолчанию закрыто
      closeMenu();
    }
  }
}

function setPageFromHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  const page = raw || CONFIG.DEFAULT_PAGE || STATE.page;
  if (page !== STATE.page) {
    navigateTo(page).catch(err => console.error("navigateTo error", err));
  } else {
    updateMenuActive(page);
  }
  if (STATE.env === "mobile") closeMenu();
}

/* navigateTo: загружает страницу по id из CONFIG */
async function navigateTo(pageId) {
  // найти описание страницы в конфиге
  const pageCfg = (CONFIG.PAGES || []).find(p => p.id === pageId);
  if (!pageCfg) {
    renderStatic("notfound");
    updateMenuActive(null);
    STATE.page = "notfound";
    return;
  }

  // если есть загруженный модуль — попытка вызвать unload()
  if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
    try { await STATE.currentModuleRef.unload(); } catch (err) { console.warn("module.unload error", err); }
  }
  STATE.currentModuleRef = null;
  STATE.currentModulePath = null;

  // обновляем локальный state и hash (hash отражает текущую страницу)
  STATE.page = pageId;
  if ((window.location.hash || "").replace(/^#/, "") !== pageId) {
    window.location.hash = pageId;
  }

  // обновляем выделение в меню
  updateMenuActive(pageId);

  // рендерим: модуль или статический шаблон
  if (pageCfg.module) {
    E.main.innerHTML = `<section class="main-block"><div id="module-root" class="module-root">Загрузка модуля...</div></section>`;
    const mount = document.getElementById("module-root");
    await loadModuleWithFallbacks(pageCfg.module, mount);
  } else {
    renderStatic(pageId);
  }

  // на мобиле после навигации закрываем меню
  if (STATE.env === "mobile") closeMenu();
}

function updateMenuActive(pageId) {
  const links = E.menu.querySelectorAll("a[data-page]");
  links.forEach(a => a.classList.toggle("active", a.dataset.page === pageId));
}

/* ----------------------
   Robust module loader with absolute URL attempts
   - принимает modulePathFromConfig, который задан в config (например "translator/index.js")
   - пробует ряд кандидатных путей в порядке приоритета:
       1) root absolute: "/translator/index.js"
       2) root with filename fallback: "/translator/translator.js" (на случай другого имени)
       3) /modules/<...>
       4) /js/modules/<...>
       5) ./modules/<...> (relative to js dir)
       6) ./<...> (relative to js dir)
   - при каждой попытке использует new URL(candidate, location.origin).href чтобы import() получал корректный абсолютный URL.
   - логирует каждую попытку в консоль (для диагностики).
   ---------------------- */
async function loadModuleWithFallbacks(modulePathFromConfig, mountEl) {
  // нормализуем вход
  const normalized = String(modulePathFromConfig || "").replace(/^\.\/+/, "");
  // создаем список кандидатов (порядок важен)
  const candidates = [
    `/${normalized}`,                                // /translator/index.js
    `/${normalized.replace(/index\.js$/, "")}translator.js`, // /translator/translator.js
    `/modules/${normalized}`,                        // /modules/translator/index.js
    `/js/modules/${normalized}`,                     // /js/modules/translator/index.js
    `./modules/${normalized}`,                       // ./modules/translator/index.js (relative)
    `./${normalized}`                                // ./translator/index.js (relative)
  ];

  // фильтруем дубли
  const seen = new Set();
  const list = candidates.filter(p => {
    if (!p) return false;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  let lastError = null;
  const tried = [];
  for (const candidate of list) {
    // создаем абсолютный URL для import()
    let attemptUrl;
    try {
      attemptUrl = new URL(candidate, location.origin).href;
    } catch (err) {
      // если URL некорректный — пропускаем
      console.warn("Invalid candidate URL", candidate, err);
      continue;
    }
    tried.push(attemptUrl);
    // логируем попытку
    console.log("module import attempt:", attemptUrl);
    try {
      // динамический import
      const mod = await import(/* @vite-ignore */ attemptUrl);
      // если успешно — сохраняем референс и вызываем render()
      STATE.currentModuleRef = mod;
      STATE.currentModulePath = attemptUrl;
      if (typeof mod.render === "function") {
        await mod.render(mountEl, { CONFIG, STATE });
      } else {
        mountEl.innerHTML = `<div class="module-error">Модуль загружен, но не содержит render() — проверь exports.</div>`;
      }
      return; // успех — выходим из функции
    } catch (err) {
      // ошибка при импортe: логируем и пробуем следующий candidate
      console.warn("module import failed for", attemptUrl, err && (err.message || err));
      lastError = err;
      // continue loop
    }
  }

  // если дошли сюда — все попытки упали
  console.error("All module import attempts failed", tried, lastError);
  mountEl.innerHTML = `
    <div class="module-error">
      Ошибка загрузки модуля. Попытки:<br/><pre>${escapeHtml(tried.join("\n"))}</pre>
      <div>Ошибка: ${escapeHtml(String(lastError && (lastError.message || lastError)))}</div>
      <div style="margin-top:10px;"><button id="module-retry">Попробовать снова</button></div>
    </div>
  `;
  const retry = document.getElementById("module-retry");
  if (retry) retry.addEventListener("click", () => loadModuleWithFallbacks(modulePathFromConfig, mountEl));
}

/* ----------------------
   Static templates fallback
   ---------------------- */
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

/* ----------------------
   Small utilities
   ---------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
