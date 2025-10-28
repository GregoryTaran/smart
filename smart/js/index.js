// smart/js/index.js
// Обновлённая, готовая к использованию версия index.js
// - Сохраняет структуру и логику из твоего файла
// - Упрощённый и надёжный модульный загрузчик (вариант A)
// - Подробные комментарии внутри — вставь файл целиком в smart/js/index.js

/* CONFIG импортируется из js/config.js */
import { CONFIG } from "./config.js";

/* -------------------------
   Application state
   ------------------------- */
const STATE = {
  env: window.innerWidth <= 768 ? "mobile" : "desktop",
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
   Init on DOM ready
   ------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  E.menu = document.getElementById("side-menu");
  E.header = document.getElementById("site-header");
  E.main = document.getElementById("content");
  E.footer = document.getElementById("site-footer");
  E.overlay = document.getElementById("overlay");
  E.wrapper = document.getElementById("wrapper");

  if (!E.menu || !E.header || !E.main) {
    console.error("Critical DOM nodes missing (side-menu/site-header/content). Check index.html structure.");
    return;
  }

  document.body.dataset.env = STATE.env;

  renderShell();
  attachGlobalEvents();

  const rawHash = (window.location.hash || "").replace(/^#\/?/, "");
  const initialPage = rawHash || STATE.page;
  navigateTo(initialPage).catch(err => console.error("Initial navigate error:", err));

  document.body.classList.remove("preload");
});

/* -------------------------
   Shell rendering
   ------------------------- */
function renderShell() {
  renderHeader();
  renderMenu();
  renderFooter();
}

/* Header */
function renderHeader() {
  E.header.innerHTML = `
    <button id="menu-toggle" aria-controls="side-menu" aria-expanded="false" aria-label="Открыть меню">☰</button>
    <div id="logo-wrap" role="link" title="${escapeHtml(CONFIG.PROJECT_NAME)}" tabindex="0" style="display:flex;align-items:center;cursor:pointer;">
      <img id="site-logo" src="assets/logo400.jpg" alt="${escapeHtml(CONFIG.PROJECT_NAME)}" />
    </div>
  `;

  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.addEventListener("click", () => toggleMenu());

  const logoWrap = E.header.querySelector("#logo-wrap");
  if (logoWrap) {
    logoWrap.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
        try { await STATE.currentModuleRef.unload(); } catch (err) { console.warn("module.unload failed on logo click", err); }
      }
      if (STATE.ui.menuOpen) closeMenu();
      try {
        await navigateTo(CONFIG.DEFAULT_PAGE || STATE.page);
      } catch (err) {
        console.warn("navigateTo on logo failed", err);
      }
      try { history.replaceState(null, "", location.origin + "/"); } catch (e) {}
    });

    logoWrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        logoWrap.click();
      }
    });
  }
}

/* Menu */
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
    a.className = p.id === STATE.page ? "active" : "";
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (p.id === STATE.page) {
        if (STATE.env === "mobile") closeMenu();
        return;
      }
      navigateTo(p.id).catch(err => console.error("navigateTo error:", err));
    });
    li.appendChild(a);
    ul.appendChild(li);
  }

  const menuHeader = document.createElement("div");
  menuHeader.className = "menu-header";
  menuHeader.innerHTML = `
    <span class="menu-title">МЕНЮ</span>
    <button id="menu-close" class="menu-close" aria-label="Закрыть меню">✕</button>
  `;

  E.menu.innerHTML = "";
  E.menu.appendChild(menuHeader);
  E.menu.appendChild(ul);

  const closeBtn = E.menu.querySelector("#menu-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeMenu());
  }
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

/* -------------------------
   Menu controls
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
   Global events
   ------------------------- */
function attachGlobalEvents() {
  window.addEventListener("hashchange", setPageFromHash);
  window.addEventListener("resize", onResize);
  if (E.overlay) E.overlay.addEventListener("click", () => closeMenu());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && STATE.ui.menuOpen) closeMenu();
  });
}

/* handle resize */
function onResize() {
  const newEnv = window.innerWidth <= 768 ? "mobile" : "desktop";
  if (newEnv !== STATE.env) {
    STATE.env = newEnv;
    document.body.dataset.env = STATE.env;
    if (STATE.env === "desktop") {
      document.body.classList.add("menu-open");
      STATE.ui.menuOpen = true;
    } else {
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

/* navigateTo */
async function navigateTo(pageId) {
  const pageCfg = (CONFIG.PAGES || []).find(p => p.id === pageId);
  if (!pageCfg) {
    renderStatic("notfound");
    updateMenuActive(null);
    STATE.page = "notfound";
    return;
  }

  if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
    try { await STATE.currentModuleRef.unload(); } catch (err) { console.warn("module.unload error:", err); }
  }
  STATE.currentModuleRef = null;
  STATE.currentModulePath = null;

  STATE.page = pageId;
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

/* update menu active */
function updateMenuActive(pageId) {
  const links = E.menu.querySelectorAll("a[data-page]");
  links.forEach(a => a.classList.toggle("active", a.dataset.page === pageId));
}

/* -------------------------
   Module loader
   - Попытки загрузки с набором candidate-путей
   - Ожидает, что модуль экспортирует render(mount, opts) по умолчанию или именованно
   - Поддерживает mod.unload() если экспортирован
   ------------------------- */
const MODULE_CANDIDATES = (name) => [
  `/${name}/index.js`,            // preferred
  `/modules/${name}/index.js`,
  `/js/modules/${name}/index.js`,
  `/${name}.js`,
  `/${name}/`,                    // server may serve index.js for folder
];

async function loadModuleWithFallbacks(modulePathFromConfig, mountEl) {
  const normalized = String(modulePathFromConfig || "").replace(/^\.\//, "");
  // if passed like "context" or "context/index.js" support both
  const name = normalized.replace(/\/index\.js$/, "").replace(/\/$/, "");
  const candidates = MODULE_CANDIDATES(name);
  const tried = [];
  let lastError = null;

  for (const candidate of candidates) {
    let attemptUrl;
    try {
      attemptUrl = new URL(candidate, location.origin).href;
    } catch (err) {
      console.warn("Invalid candidate URL", candidate, err);
      continue;
    }
    // avoid duplicates
    if (tried.includes(attemptUrl)) continue;
    tried.push(attemptUrl);
    console.log("module import attempt:", attemptUrl);
    try {
      // dynamic import — allow cross-origin absolute urls, so use /* @vite-ignore */ or similar in bundlers
      const mod = await import(/* @vite-ignore */ attemptUrl);
      // keep ref
      STATE.currentModuleRef = mod;
      STATE.currentModulePath = attemptUrl;

      // find render
      const renderFn = (mod && (mod.default || mod.render));
      if (!renderFn || typeof renderFn !== "function") {
        // if module executed side-effect and attached window.contextRender (legacy)
        if (typeof window !== "undefined" && typeof window.contextRender === "function") {
          await Promise.resolve(window.contextRender(mountEl, { CONFIG, STATE }));
        } else {
          throw new Error("Модуль загружен, но не экспортирует render(mount). Ожидается default export или named export 'render'.");
        }
      } else {
        await Promise.resolve(renderFn(mountEl, { CONFIG, STATE }));
      }

      // done
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
   Static templates
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
   Utilities
   ------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
