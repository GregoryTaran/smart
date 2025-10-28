// smart/js/index.js
// Unified client entry — исправленная версия (initial render, logo behavior, robust handlers).
// Комментарии объясняют блоки. Заменять файл целиком.

/* CONFIG импортируется из js/config.js (тот же файл что у тебя) */
import { CONFIG } from "./config.js";

/* -------------------------
   Application state
   ------------------------- */
const STATE = {
  env: window.innerWidth <= 768 ? "mobile" : "desktop", // текущий режим
  page: CONFIG.DEFAULT_PAGE || (CONFIG.PAGES && CONFIG.PAGES[0] && CONFIG.PAGES[0].id) || "home",
  ui: { menuOpen: false },
  currentModuleRef: null,
  currentModulePath: null
};

/* -------------------------
   Cached DOM references
   ------------------------- */
const E = {
  menu: null,
  header: null,
  main: null,
  footer: null,
  overlay: null,
  wrapper: null
};

/* -------------------------
   DOMContentLoaded init
   ------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // Сохраняем ссылки на основные элементы (index.html предполагает их наличие)
  E.menu = document.getElementById("side-menu");
  E.header = document.getElementById("site-header");
  E.main = document.getElementById("content");
  E.footer = document.getElementById("site-footer");
  E.overlay = document.getElementById("overlay");
  E.wrapper = document.getElementById("wrapper");

  // Если элементы не найдены — выводим ошибку в консоль и выходим
  if (!E.menu || !E.header || !E.main) {
    console.error("Critical DOM nodes missing (side-menu/site-header/content). Check index.html structure.");
    return;
  }

  // Установить начальный env-тег на body
  document.body.dataset.env = STATE.env;

  // Построить оболочку: header/menu/footer
  renderShell();

  // Навесить глобальные события
  attachGlobalEvents();

  // Всегда делаем initial navigate — чтобы главная отрисовалась на загрузке.
  // Если есть hash, navigateTo его (hash приоритетен).
  const rawHash = (window.location.hash || "").replace(/^#\/?/, "");
  const initialPage = rawHash || STATE.page;
  navigateTo(initialPage).catch(err => console.error("Initial navigate error:", err));

  // Снять возможный preload класс
  document.body.classList.remove("preload");
});

/* -------------------------
   Shell rendering
   ------------------------- */
function renderShell() {
  renderHeader();  // отрисовать header (логотип + toggle)
  renderMenu();    // отрисовать меню на основе CONFIG.PAGES
  renderFooter();  // отрисовать footer
}

/* Header rendering: логотип кликабельный, кнопка меню */
function renderHeader() {
  E.header.innerHTML = `
    <button id="menu-toggle" aria-controls="side-menu" aria-expanded="false" aria-label="Открыть меню">☰</button>
    <div id="logo-wrap" role="link" title="${escapeHtml(CONFIG.PROJECT_NAME)}" tabindex="0" style="display:flex;align-items:center;cursor:pointer;">
      <img id="site-logo" src="assets/logo400.jpg" alt="${escapeHtml(CONFIG.PROJECT_NAME)}" />
    </div>
  `;

  // menu toggle
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.addEventListener("click", () => toggleMenu());

  // logo behavior:
  //  - вызываем unload() у модуля если есть,
  //  - навигируем на DEFAULT_PAGE (без перезагрузки),
  //  - затем заменяем URL в адресной строке на корень (history.replaceState) — чтобы не оставался хеш.
  const logoWrap = E.header.querySelector("#logo-wrap");
  if (logoWrap) {
    logoWrap.addEventListener("click", async (ev) => {
      ev.preventDefault();
      // попытка аккуратно выгрузить модуль
      if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
        try { await STATE.currentModuleRef.unload(); } catch (err) { console.warn("module.unload failed on logo click", err); }
      }
      // закрыть меню если открыто
      if (STATE.ui.menuOpen) closeMenu();
      // навигация на дефолтную страницу (обновляет state и content)
      try {
        await navigateTo(CONFIG.DEFAULT_PAGE || STATE.page);
      } catch (err) {
        console.warn("navigateTo on logo failed", err);
      }
      // убрать хеш/путь — показать просто origin/
      try {
        history.replaceState(null, "", location.origin + "/");
      } catch (e) {
        // ignore if not allowed
      }
    });

    // keyboard support (Enter/Space)
    logoWrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        logoWrap.click();
      }
    });
  }
}

/* Menu rendering from CONFIG */
function renderMenu() {
  const pages = Array.isArray(CONFIG.PAGES) ? CONFIG.PAGES : [];
  const ul = document.createElement("ul");
  ul.className = "menu-list";

  for (const p of pages) {
    if (!p.id || !p.label) continue;
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${p.id}`;
    a.dataset.page = p.id;
    a.textContent = p.label;
    a.setAttribute("role", "link");
    // active class based on current state
    a.className = p.id === STATE.page ? "active" : "";
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      // если нажали на ту же страницу — просто закроем меню (mobile)
      if (p.id === STATE.page) {
        if (STATE.env === "mobile") closeMenu();
        return;
      }
      navigateTo(p.id).catch(err => console.error("navigateTo error:", err));
    });
    li.appendChild(a);
    ul.appendChild(li);
  }

  // menu header with close button (visible on mobile; hidden via CSS on desktop)
  const menuHeader = document.createElement("div");
  menuHeader.className = "menu-header";
  menuHeader.innerHTML = `
    <span class="menu-title">МЕНЮ</span>
    <button id="menu-close" class="menu-close" aria-label="Закрыть меню">✕</button>
  `;

  // add to DOM
  E.menu.innerHTML = "";
  E.menu.appendChild(menuHeader);
  E.menu.appendChild(ul);

  // attach close handler AFTER adding node to DOM to avoid missing binding
  const closeBtn = E.menu.querySelector("#menu-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeMenu());
  }
}

/* Footer renderer */
function renderFooter() {
  E.footer.innerHTML = `
    <div class="footer-links">
      <a href="#policy">Политика</a> · <a href="#terms">Условия</a>
    </div>
    <div class="footer-meta">© ${new Date().getFullYear()} ${escapeHtml(CONFIG.PROJECT_NAME)}</div>
  `;
}

/* -------------------------
   Menu controls: open/close + keyboard focus trap
   ------------------------- */
function toggleMenu() {
  if (STATE.ui.menuOpen) closeMenu(); else openMenu();
}

function openMenu() {
  STATE.ui.menuOpen = true;
  document.body.classList.add("menu-open");
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  if (E.overlay) E.overlay.setAttribute("aria-hidden", "false");
  // focus first interactive in menu
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
  if (E.overlay) E.overlay.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", handleMenuKeydown);
  // return focus to toggle
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

/* -------------------------
   Global events: hashchange, resize, overlay click
   ------------------------- */
function attachGlobalEvents() {
  window.addEventListener("hashchange", setPageFromHash);
  window.addEventListener("resize", onResize);
  if (E.overlay) E.overlay.addEventListener("click", () => closeMenu());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && STATE.ui.menuOpen) closeMenu();
  });
}

/* handle resize: switch env and ensure menu state consistent */
function onResize() {
  const newEnv = window.innerWidth <= 768 ? "mobile" : "desktop";
  if (newEnv !== STATE.env) {
    STATE.env = newEnv;
    document.body.dataset.env = STATE.env;
    if (STATE.env === "desktop") {
      // on desktop, we want menu visible by default (visual)
      document.body.classList.add("menu-open");
      STATE.ui.menuOpen = true;
    } else {
      // on mobile, default closed
      closeMenu();
    }
  }
}

/* -------------------------
   Routing helpers
   ------------------------- */
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

/* navigateTo: core navigation logic */
async function navigateTo(pageId) {
  const pageCfg = (CONFIG.PAGES || []).find(p => p.id === pageId);
  if (!pageCfg) {
    renderStatic("notfound");
    updateMenuActive(null);
    STATE.page = "notfound";
    return;
  }

  // try unload previous module if any
  if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
    try { await STATE.currentModuleRef.unload(); } catch (err) { console.warn("module.unload error:", err); }
  }
  STATE.currentModuleRef = null;
  STATE.currentModulePath = null;

  STATE.page = pageId;
  // set hash to reflect current page (except when we just used logo -> and replaced URL)
  if ((window.location.hash || "").replace(/^#/, "") !== pageId) {
    window.location.hash = pageId;
  }

  updateMenuActive(pageId);

  if (pageCfg.module) {
    E.main.innerHTML = `<section class="main-block"><div id="module-root" class="module-root">Загрузка модуля...</div></section>`;
    const mount = document.getElementById("module-root");
    await loadModuleWithFallbacks(pageCfg.module, mount);
  } else {
    renderStatic(pageId);
  }

  if (STATE.env === "mobile") closeMenu();
}

/* update menu active classes */
function updateMenuActive(pageId) {
  const links = E.menu.querySelectorAll("a[data-page]");
  links.forEach(a => a.classList.toggle("active", a.dataset.page === pageId));
}

/* -------------------------
   Robust module loader (absolute URL attempts)
   - попробует /<normalized>, /<folder>/<name>.js, /modules/..., /js/modules/... и относительные
   - использует new URL(candidate, location.origin).href для import()
   ------------------------- */
async function loadModuleWithFallbacks(modulePathFromConfig, mountEl) {
  const normalized = String(modulePathFromConfig || "").replace(/^\.\/+/, "");
  const candidates = [
    `/${normalized}`,                                        // /translator/index.js
    `/${normalized.replace(/index\.js$/, "")}translator.js`, // /translator/translator.js
    `/modules/${normalized}`,                                // /modules/translator/index.js
    `/js/modules/${normalized}`,                             // /js/modules/translator/index.js
    `./modules/${normalized}`,                               // ./modules/translator/index.js (relative)
    `./${normalized}`                                        // ./translator/index.js (relative)
  ];

  const seen = new Set();
  const list = candidates.filter(p => {
    if (!p) return false;
    if (seen.has(p)) return false;
    seen.add(p); return true;
  });

  let lastError = null;
  const tried = [];
  for (const candidate of list) {
    let attemptUrl;
    try {
      attemptUrl = new URL(candidate, location.origin).href;
    } catch (err) {
      console.warn("Invalid candidate URL", candidate, err);
      continue;
    }
    tried.push(attemptUrl);
    console.log("module import attempt:", attemptUrl);
    try {
      // dynamic import with absolute URL
      const mod = await import(/* @vite-ignore */ attemptUrl);
      STATE.currentModuleRef = mod;
      STATE.currentModulePath = attemptUrl;
      if (typeof mod.render === "function") {
        await mod.render(mountEl, { CONFIG, STATE });
      } else {
        mountEl.innerHTML = `<div class="module-error">Модуль загружен, но не содержит render()</div>`;
      }
      return;
    } catch (err) {
      console.warn("module import failed for", attemptUrl, err && (err.message || err));
      lastError = err;
      // try next candidate
    }
  }

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

/* -------------------------
   Static page templates (fallback)
   ------------------------- */
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

/* -------------------------
   Utility
   ------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
