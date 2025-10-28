// js/index.js
// SMART VISION — SPA loader (robust + safe)
// - expects site config in window.CONFIG (js/config.js should set it before this script runs)
// - loads page modules by absolute path: /<module>?v=VERSION (or uses CONFIG.BASE_URL)
// - renders modules into #page-content and NEVER removes header/footer/menu
// - safeImport with timeout, unload() contract for modules, friendly errors
// - exposes window.SV.loadPage and window.APP.addWorklet
// - authored: Bro-approved, a tiny joke in the logs

(function () {
  console.log("SMART VISION loader — ваш Бро. Смотрю аккуратно, шучу по делу.");

  // --- Config (fallback try import if window.CONFIG absent) ---
  async function ensureConfig() {
    if (window.CONFIG) return window.CONFIG;
    try {
      // config likely at /js/config.js — try to import as script-exported global first,
      // or dynamic import if it's an ESM export.
      if (await tryFetch("/js/config.js")) {
        // if script attached earlier it should have set window.CONFIG
        if (window.CONFIG) return window.CONFIG;
        // otherwise try dynamic import
        const m = await import("/js/config.js?v=" + Date.now());
        if (m && (m.CONFIG || m.default)) {
          window.CONFIG = m.CONFIG || m.default;
          return window.CONFIG;
        }
      }
    } catch (e) {
      console.warn("config load fallback failed:", e && e.message ? e.message : e);
    }
    // final fallback minimal config
    window.CONFIG = window.CONFIG || { BASE_URL: "", VERSION: String(new Date().toISOString().slice(0,10)), MOUNT_ID: "app", PAGES: [] };
    return window.CONFIG;
  }

  // quick HEAD check to avoid 404 import attempt (helps in some CDNs)
  async function tryFetch(path) {
    try {
      const r = await fetch(path, { method: "HEAD", cache: "no-store" });
      return r && (r.status === 200 || r.status === 204);
    } catch { return false; }
  }

  // --- helpers ---
  function moduleUrl(modulePath) {
    const cfg = window.CONFIG || {};
    const base = (cfg.BASE_URL || "").replace(/\/$/, "");
    const trimmed = String(modulePath || "").replace(/^\//, "");
    const version = encodeURIComponent(cfg.VERSION || "");
    return (base ? base + "/" : "/") + trimmed + (version ? `?v=${version}` : "");
  }

  // addWorklet helper
  window.APP = window.APP || {};
  window.APP.addWorklet = async function (audioCtx, relPath) {
    const url = moduleUrl(relPath);
    return audioCtx.audioWorklet.addModule(url);
  };

  // expose SV
  window.SV = window.SV || {};
  // will be set later: SV.pages, SV.loadPage, SV.config

  // --- page list normalization ---
  function normalizePages(pages) {
    if (!pages) return {};
    if (Array.isArray(pages)) {
      const map = {};
      for (const p of pages) if (p && p.id && p.module) map[p.id] = p;
      return map;
    }
    if (typeof pages === "object") {
      // object map or keyed config
      const map = {};
      for (const k of Object.keys(pages)) {
        const v = pages[k];
        if (typeof v === "string") map[k] = { id: k, module: v, label: k };
        else if (v && v.module) map[k] = Object.assign({ id: k }, v);
      }
      return map;
    }
    return {};
  }

  // --- DOM helpers for graceful UI in #page-content ---
  function getPageContentContainer() {
    // prefer explicit id 'page-content' (rendered by menu1.js). fallback to mount or #app.
    const byId = document.getElementById("page-content");
    if (byId) return byId;
    const mount = document.getElementById((window.CONFIG && window.CONFIG.MOUNT_ID) || "app");
    if (mount) return mount;
    const body = document.body;
    return body;
  }

  function showLoadingIn(container, text = "Загрузка…") {
    container.innerHTML = `<div class="sv-loading" style="padding:18px;color:#444">${escapeHtml(text)}</div>`;
  }

  function showModuleError(container, title, message) {
    container.innerHTML = `
      <div class="sv-module-error" style="padding:18px;border-radius:8px;background:#fff6f6;color:#a00">
        <strong>${escapeHtml(title)}</strong>
        <div style="margin-top:8px;color:#333">${escapeHtml(message)}</div>
        <div style="margin-top:10px"><button id="sv-retry-btn" style="padding:8px 12px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer">Попробовать снова</button></div>
      </div>`;
    const btn = document.getElementById("sv-retry-btn");
    if (btn) btn.addEventListener("click", () => {
      // re-trigger hashchange handling
      handleHashChange();
    });
  }

  function escapeHtml(s) { return String(s || "").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // --- safe dynamic import with timeout ---
  function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }
  async function safeImport(specifier, msTimeout = 8000) {
    // race import with timeout
    return Promise.race([ import(specifier), timeout(msTimeout) ]);
  }

  // --- module lifecycle tracking ---
  let currentModuleApi = null; // module exports object for unload
  let currentModulePath = null;

  async function unloadCurrentModule() {
    if (currentModuleApi && typeof currentModuleApi.unload === "function") {
      try {
        await currentModuleApi.unload();
      } catch (e) {
        console.warn("Error during module unload()", e);
      }
    } else if (currentModuleApi && typeof currentModuleApi.dispose === "function") {
      try {
        await currentModuleApi.dispose();
      } catch (e) {
        console.warn("Error during module dispose()", e);
      }
    }
    currentModuleApi = null;
    currentModulePath = null;
  }

  // --- protected render pipeline ---
  async function renderModuleSafely(modulePath) {
    const container = getPageContentContainer();
    if (!container) {
      console.error("No container for page content");
      return;
    }

    // unload previous module first (graceful)
    await unloadCurrentModule();

    showLoadingIn(container, `Загрузка ${modulePath}…`);

    const url = moduleUrl(modulePath);
    try {
      const mod = await safeImport(url, 8000); // 8s timeout
      // find runner
      const runner = mod.render || mod.default || mod.init || mod.main;
      if (!runner || typeof runner !== "function") {
        throw new Error("Модуль загружен, но не экспортирует render/default/init/main");
      }

      // runner should render into container; wrap in try/catch
      try {
        const maybe = runner(container);
        if (maybe && typeof maybe.then === "function") await maybe;
        // keep module exports for later unload
        currentModuleApi = mod;
        currentModulePath = modulePath;
      } catch (e) {
        console.error("Error during module render:", e);
        showModuleError(container, "Ошибка модуля при рендере", e && e.message ? e.message : String(e));
      }
    } catch (e) {
      console.error("Failed to load module:", e);
      let msg = e && e.message ? e.message : String(e);
      if (msg === "timeout") msg = "Время загрузки модуля истекло";
      showModuleError(container, "Не удалось загрузить страницу", msg);
    }
  }

  // --- Router: hash-based ---
  function getPageIdFromHash() {
    const h = (location.hash || "").replace(/^#/, "");
    const p = h.replace(/^\//, "");
    return p || null;
  }

  // Fallback list when CONFIG.PAGES empty: try to load one of these modules
  const FALLBACK_TRIES = [
    "js/menu1.js", "js/menu.js", "js/context/context.js", "js/context/index.js",
    "js/translator/translator.js", "js/translate/index.js", "js/app.js"
  ];

  async function tryFallbacks() {
    const container = getPageContentContainer();
    for (const p of FALLBACK_TRIES) {
      try {
        await renderModuleSafely(p);
        // if success (no error UI) then stop
        return;
      } catch (e) {
        // continue trying others
      }
    }
    // if none worked, show global hint
    const c = getPageContentContainer();
    c.innerHTML = `<div style="padding:18px;color:#666">Не найдено ни одного модуля для отображения. Проверьте js/config.js и файлы в /js/. (Бро советует: убедись, что menu1.js или context/index.js на месте.)</div>`;
  }

  // --- Menu highlighting helper (menu1.js should define updateMenuActive but we call anyway) ---
  function updateMenuActive(pageId) {
    if (window.updateMenuActive) {
      try { window.updateMenuActive(pageId); } catch (e) { /* ignore */ }
    } else {
      // fallback: try to highlight links with data-page
      const links = document.querySelectorAll('[data-page]');
      links.forEach(l => {
        const id = l.getAttribute('data-page');
        if (id === pageId) {
          l.classList && l.classList.add('active');
          l.style.background = "#0f62fe"; l.style.color = "#fff";
        } else {
          if (l.classList) l.classList.remove('active');
          l.style.background = "transparent"; l.style.color = "#333";
        }
      });
    }
  }

  // --- handle hash change and initial load ---
  let PAGES_MAP = {};

  async function handleHashChange() {
    const pageId = getPageIdFromHash();
    if (pageId) {
      const entry = PAGES_MAP[pageId];
      if (entry && entry.module) {
        updateMenuActive(pageId);
        await renderModuleSafely(entry.module);
        return;
      } else {
        // requested unknown pageId -> try fallback attempts but don't crash
        const container = getPageContentContainer();
        showLoadingIn(container, `Страница "${pageId}" не найдена — пробуем автопоиск...`);
        await tryFallbacks();
        return;
      }
    }

    // No hash: load default page from config if any, else try fallbacks
    const keys = Object.keys(PAGES_MAP);
    if (keys.length) {
      const def = keys[0]; // first declared as default
      updateMenuActive(def);
      await renderModuleSafely(PAGES_MAP[def].module);
      return;
    }

    // no pages configured, fallback
    await tryFallbacks();
  }

  // attach hash listener
  window.addEventListener("hashchange", () => { handleHashChange().catch(e=>console.error(e)); }, false);

  // --- attach delegated click handler for nav links [data-page] to set hash ---
  document.body.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest('[data-page]');
    if (!a) return;
    const pid = a.getAttribute('data-page');
    if (!pid) return;
    ev.preventDefault();
    location.hash = `#/${pid}`;
  });

  // --- public API ---
  window.SV = window.SV || {};
  window.SV.loadPage = (id) => { location.hash = `#/${id}`; };
  window.SV.pages = () => PAGES_MAP;
  window.SV.config = () => window.CONFIG;

  // --- bootstrap: ensure config, build pages map and start ---
  (async function bootstrap() {
    await ensureConfig();
    const cfg = window.CONFIG || {};
    PAGES_MAP = normalizePages(cfg.PAGES || {});
    // expose pages map
    window.SV.pages = () => PAGES_MAP;

    // If menu renderer exists (menu1.js) we should let it render; but loader's job is to ensure content loads.
    // Initial handle
    try {
      await handleHashChange();
    } catch (e) {
      console.error("Initial load error:", e);
      const c = getPageContentContainer();
      c.innerHTML = `<div style="padding:18px;color:#900">Ошибка инициализации: ${escapeHtml(e && e.message ? e.message : String(e))}</div>`;
    }

    // small log for devs
    console.log("Loader ready. Pages:", Object.keys(PAGES_MAP).join(", ") || "(none declared).");
  })();

})();
