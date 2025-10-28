// js/index.js
import { CONFIG } from "./config.js";

/*
  Unified index.js
  - render header/menu/footer
  - accessible mobile menu with focus trap
  - router (hash)
  - safe dynamic module loading from ./modules/
  - contract: module.render(container, opts), module.unload()
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
  E.menu = document.getElementById("side-menu");
  E.header = document.getElementById("site-header");
  E.main = document.getElementById("content");
  E.footer = document.getElementById("site-footer");
  E.overlay = document.getElementById("overlay");
  E.wrapper = document.getElementById("wrapper");

  document.body.dataset.env = STATE.env;
  renderShell();
  attachGlobalEvents();
  setPageFromHash();
  document.body.classList.remove("preload");
  console.log("index.js initialized — env:", STATE.env);
});

/* --------------------------
   Shell (header, menu, footer)
   -------------------------- */
function renderShell() {
  renderHeader();
  renderMenu(); // построит меню на основе CONFIG.PAGES
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
    // skip hidden pages if wanted: we respect only pages with id/label
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

  // header inside menu (with close btn for mobile)
  const menuHeader = document.createElement("div");
  menuHeader.className = "menu-header";
  menuHeader.innerHTML = `
    <span class="menu-title">МЕНЮ</span>
    <button id="menu-close" class="menu-close" aria-label="Закрыть меню">✕</button>
  `;

  // clear and append
  E.menu.innerHTML = "";
  E.menu.appendChild(menuHeader);
  E.menu.appendChild(list);

  const closeBtn = E.menu.querySelector("#menu-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeMenu());

  // Ensure first focusable element for focus trap
  E.menuFirstFocusable = E.menu.querySelector("a, button");
  E.menuLastFocusable = list.querySelector("a:last-of-type") || closeBtn;
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
   Menu open/close + focus trap
   -------------------------- */
function toggleMenu() {
  if (STATE.ui.menuOpen) closeMenu();
  else openMenu();
}

function openMenu() {
  STATE.ui.menuOpen = true;
  document.body.classList.add("menu-open");
  E.header.querySelector("#menu-toggle").setAttribute("aria-expanded", "true");
  E.overlay.setAttribute("aria-hidden", "false");
  // accessibility: trap focus inside menu
  setTimeout(() => {
    const first = E.menu.querySelector("a, button");
    if (first) first.focus();
  }, 10);
  document.addEventListener("keydown", handleMenuKeydown);
}

function closeMenu() {
  STATE.ui.menuOpen = false;
  document.body.classList.remove("menu-open");
  E.header.querySelector("#menu-toggle").setAttribute("aria-expanded", "false");
  E.overlay.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", handleMenuKeydown);
  // return focus to menu toggle
  const toggle = E.header.querySelector("#menu-toggle");
  if (toggle) toggle.focus();
}

function handleMenuKeydown(e) {
  if (!STATE.ui.menuOpen) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeMenu();
    return;
  }
  // focus trap Tab
  if (e.key === "Tab") {
    const focusables = Array.from(E.menu.querySelectorAll("a,button")).filter(Boolean);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/* --------------------------
   Router + module loading
   -------------------------- */
function attachGlobalEvents() {
  window.addEventListener("hashchange", setPageFromHash);
  window.addEventListener("resize", onResize);
  E.overlay.addEventListener("click", () => closeMenu());
  // keyboard: global Escape to close menu if open
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && STATE.ui.menuOpen) {
      closeMenu();
    }
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
  if (page !== STATE.page) {
    navigateTo(page);
  } else {
    // still update active classes if needed
    updateMenuActive(page);
  }
  if (STATE.env === "mobile") closeMenu();
}

async function navigateTo(pageId) {
  // ensure page exists in config
  const pageCfg = (CONFIG.PAGES || []).find(p => p.id === pageId);
  if (!pageCfg) {
    renderStatic("notfound");
    updateMenuActive(null);
    STATE.page = "notfound";
    return;
  }

  // call unload if module present
  if (STATE.currentModuleRef && typeof STATE.currentModuleRef.unload === "function") {
    try { await STATE.currentModuleRef.unload(); } catch (e) { console.warn("module.unload error:", e); }
  }
  STATE.currentModuleRef = null;
  STATE.currentModulePath = null;

  STATE.page = pageId;
  // update the hash (without adding extra history if already correct)
  if ((window.location.hash || "").replace(/^#/, "") !== pageId) {
    window.location.hash = pageId;
  }

  updateMenuActive(pageId);

  if (pageCfg.module) {
    const safePath = sanitizeModulePath(pageCfg.module); // returns like './modules/context/index.js'
    E.main.innerHTML = `<section class="main-block"><div id="module-root" class="module-root">Загрузка...</div></section>`;
    const mount = document.getElementById("module-root");
    await loadModuleSafe(safePath, mount);
  } else {
    renderStatic(pageId);
  }

  if (STATE.env === "mobile") closeMenu();
}

function updateMenuActive(pageId) {
  const links = E.menu.querySelectorAll("a[data-page]");
  links.forEach(a => a.classList.toggle("active", a.dataset.page === pageId));
}

/* Module helpers */
function sanitizeModulePath(modulePath) {
  // allow only relative inside /modules/ and strip dangerous fragments
  // modulePath expected like "context/index.js" or "translator/index.js"
  const cleaned = String(modulePath).replace(/^\/+/, "").replace(/\.\./g, "").replace(/^https?:\/\//, "");
  return `./modules/${cleaned}`;
}

async function loadModuleSafe(path, mountEl) {
  try {
    const mod = await import(path);
    STATE.currentModuleRef = mod;
    STATE.currentModulePath = path;
    if (typeof mod.render === "function") {
      await mod.render(mountEl, { CONFIG, STATE });
    } else {
      mountEl.innerHTML = `<div class="module-error">Модуль загружен, но не содержит render()</div>`;
    }
  } catch (err) {
    console.error("Ошибка загрузки модуля:", err);
    mountEl.innerHTML = `
      <div class="module-error">Ошибка загрузки модуля: ${escapeHtml(String(err && err.message || err))}</div>
      <div style="margin-top:12px;"><button id="module-retry">Повторить</button></div>
    `;
    const retry = document.getElementById("module-retry");
    if (retry) retry.addEventListener("click", () => loadModuleSafe(path, mountEl));
  }
}

/* Static page renderer fallback */
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
   Utils
   -------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
