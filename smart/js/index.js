// ======== Smart Vision INDEX (v2.7 — ленивый импорт Translator) ========

import { CONFIG } from "./config.js";
import { renderMenu } from "./menu1.js";

console.log(`🌍 Smart Vision (${CONFIG.PROJECT_NAME}) v${CONFIG.VERSION}`);

const STATE = {
  env: window.SMART_ENV || (window.innerWidth <= 768 ? "mobile" : "desktop"),
  user: null,
  page: "home",
  uiFlags: { menuOpen: false, debugVisible: false }
};

const root = {};

let userCode = localStorage.getItem("userCode");
if (!userCode) {
  userCode = "user-" + Math.random().toString(36).substring(2, 10);
  localStorage.setItem("userCode", userCode);
}
STATE.user = { name: userCode };

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

function init() {
  root.header = document.querySelector("header");
  root.menu = document.getElementById("side-menu");
  root.main = document.getElementById("content");
  root.footer = document.getElementById("footer");
  root.overlay = document.getElementById("overlay");
  root.wrapper = document.getElementById("wrapper");

  document.body.dataset.env = STATE.env;

  document.body.classList.remove("menu-open");
  STATE.uiFlags.menuOpen = false;

  if (STATE.env === "desktop") {
    root.menu.style.transition = "none";
    document.body.classList.add("menu-open");
    STATE.uiFlags.menuOpen = true;
    setTimeout(() => (root.menu.style.transition = ""), 100);
  }

  setPageFromHash();
  renderApp();
  attachGlobalEvents();
  initSwipe();
  updateEnvButton();

  document.body.classList.remove("preload");
  console.log(`✅ Smart Vision initialized (${STATE.env})`);
}

function renderApp() {
  renderHeader();
  renderMenuBlock();
  renderMain();
  renderFooter();
  updateEnvButton();
}

function renderHeader() {
  root.header.innerHTML = `
    <button id="menu-toggle" aria-label="Открыть меню">☰</button>
    <div id="logo-wrap"><img src="assets/logo400.jpg" alt="Smart Vision" id="logo"></div>
  `;
  document.getElementById("menu-toggle").onclick = toggleMenu;
}

function renderMenuBlock() {
  root.menu.innerHTML = renderMenu(STATE.page, STATE.user);
  const closeBtn = document.getElementById("menu-close");
  if (closeBtn) closeBtn.onclick = closeMenu;

  root.menu.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest("a[data-page]");
      if (!a) return;
      const next = a.dataset.page;
      if (next && next !== STATE.page) {
        STATE.page = next;
        window.location.hash = next;
        renderApp();
        if (STATE.env === "mobile") closeMenu();
        root.main.scrollIntoView({ behavior: "smooth", block: "start" });
        e.preventDefault();
      }
    },
    { once: true }
  );
}

async function renderMain() {
  const pageCfg = CONFIG.PAGES.find((p) => p.id === STATE.page);

  // 🟢 Ленивый импорт translator.js
  if (STATE.page === "translator") {
    root.main.innerHTML = `<section class="main-block"><div id="module-root"></div></section>`;
    const mount = document.getElementById("module-root");
    const { renderTranslator } = await import("../translator/translator.js");
    renderTranslator(mount);
    return;
  }

  if (pageCfg && pageCfg.module) {
    root.main.innerHTML = `<section class="main-block"><div id="module-root"></div></section>`;
    const mount = document.getElementById("module-root");
    loadModule(pageCfg.module, mount);
    updateEnvButton();
    return;
  }

  const content = {
    home: `
      <section class="main-block">
        <h2>Главная страница</h2>
        <p>Добро пожаловать в Smart Vision — место, где ясность превращается в действие.</p>
      </section>`,
    about: `
      <section class="main-block">
        <h2>О нас</h2>
        <p>Smart Vision — проект ясности, фокуса и интеллекта как формы присутствия.</p>
      </section>`,
    policy: `
      <section class="main-block">
        <h2>Политика конфиденциальности</h2>
        <p>Smart Vision уважает вашу конфиденциальность и обрабатывает данные ответственно.</p>
      </section>`,
    terms: `
      <section class="main-block">
        <h2>Условия использования</h2>
        <p>Используя Smart Vision, вы соглашаетесь с нашими принципами ясности и ответственности.</p>
      </section>`,
    contacts: `
      <section class="main-block">
        <h2>Контакты</h2>
        <p>Связаться: <a href="mailto:info@smartvision.life">info@smartvision.life</a></p>
      </section>`,
    dashboard: `
      <section class="main-block">
        <h2>Личный кабинет</h2>
        <p>Добро пожаловать в ваш Smart Vision Dashboard.</p>
      </section>`,
    notfound: `<section class="main-block"><h2>Страница не найдена</h2></section>`
  };

  root.main.innerHTML = content[STATE.page] || content.notfound;
  updateEnvButton();
}

async function loadModule(moduleName, mountEl) {
  try {
    const url = `../${moduleName}/module.js?v=${encodeURIComponent(CONFIG.VERSION)}`;
    const mod = await import(url);
    if (typeof mod.render === "function") {
      await mod.render(mountEl);
    } else {
      mountEl.innerHTML = "<p>Модуль не содержит render()</p>";
    }
  } catch (e) {
    console.error("❌ Ошибка загрузки модуля:", e);
    mountEl.innerHTML = "<p>Ошибка загрузки модуля</p>";
  }
}

function renderFooter() {
  root.footer.innerHTML = `
    <a href="#policy">Политика конфиденциальности</a><br>
    <a href="#terms">Условия использования</a><br>
    <small>© 2025 Smart Vision</small>
    <div style="margin-top:10px;">
      <button id="env-btn" class="env-btn">${formatState()}</button>
    </div>
  `;
}

function formatState() {
  const { env, user, page, uiFlags } = STATE;
  return `{ env:${env}, user:${user ? user.name : "guest"}, page:${page}, menu:${uiFlags.menuOpen} }`;
}

function updateEnvButton() {
  const btn = document.getElementById("env-btn");
  if (btn) btn.textContent = formatState();
}

function attachGlobalEvents() {
  root.overlay.onclick = closeMenu;
  window.addEventListener("hashchange", setPageFromHash);
}

function toggleMenu() {
  STATE.uiFlags.menuOpen = !STATE.uiFlags.menuOpen;
  document.body.classList.toggle("menu-open", STATE.uiFlags.menuOpen);
  document.body.classList.toggle("menu-closed", !STATE.uiFlags.menuOpen);
  updateEnvButton();
}

function closeMenu() {
  STATE.uiFlags.menuOpen = false;
  document.body.classList.remove("menu-open");
  updateEnvButton();
}

function setPageFromHash() {
  const hash = window.location.hash.replace("#", "") || "home";
  if (hash !== STATE.page) {
    STATE.page = hash;
    renderApp();
  }
  if (STATE.env === "mobile") closeMenu();
}

let touchStartX = 0;
let touchEndX = 0;

function initSwipe() {
  if (STATE.env !== "mobile") return;
  window.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  });
  window.addEventListener("touchend", (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  });
}

function handleSwipe() {
  const dx = touchEndX - touchStartX;
  if (dx < -70 && STATE.uiFlags.menuOpen) closeMenu();
  if (dx > 70 && !STATE.uiFlags.menuOpen) toggleMenu();
}
