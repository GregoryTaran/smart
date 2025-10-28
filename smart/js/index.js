// index.js — minimal SPA module loader for SMART VISION
// - грузит модули по абсолютным путям от корня (или CONFIG.BASE_URL)
// - использует ?v=VERSION для сброса кеша
// - поддерживает hash-based маршруты (/#/pageId)
// - поставляет простой API: loadPage(pageId)
// - expose window.APP.helper для ворклета: APP.addWorklet(audioCtx, moduleRelPath)
//
// Помести этот файл вместо старого index.js в клиент (smart/).
// Про сервер: статик должен отдавать корень клиента (process.cwd()/smart) — так и настроено у вас.

(function () {
  // friendly banner — коротко и мило
  console.log("SMART VISION — frontend loader. Ассистент: Бро. Быстро и аккуратно.");

  // --- CONFIG: ожидаем, что config.js определяет window.CONFIG ---
  const CONFIG = window.CONFIG || {};
  const BASE = (CONFIG.BASE_URL ? String(CONFIG.BASE_URL).replace(/\/$/, '') : '') || ''; // без завершающего '/'
  const VERSION = CONFIG.VERSION || (new Date()).toISOString().slice(0,10);

  // root DOM
  const MOUNT_ID = CONFIG.MOUNT_ID || "app";
  const mount = document.getElementById(MOUNT_ID) || createMount(MOUNT_ID);

  // small UI helpers
  function createMount(id) {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
    return el;
  }

  function showLoading(text = "Loading…") {
    mount.innerHTML = `<div style="padding:18px;color:#444;font-family:Inter,system-ui,Segoe UI,Roboto,'Helvetica Neue',Arial;"><strong>${text}</strong></div>`;
  }
  function showError(err) {
    mount.innerHTML = `<div style="padding:18px;color:#a00;background:#fff6f6;border-radius:8px;font-family:Inter,system-ui,Segoe UI,Roboto,'Helvetica Neue',Arial;">
      <strong>Ошибка загрузки модуля</strong><div style="margin-top:8px;color:#333">${escapeHtml(String(err))}</div>
      <div style="margin-top:8px;color:#666;font-size:13px">Если что — зовите Бро (и горячий кофе).</div>
    </div>`;
    console.error("Module load error:", err);
  }
  function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Helper: build absolute URL for module paths
  function moduleUrl(modulePath) {
    const trimmed = String(modulePath).replace(/^\//, "");
    return `${BASE}/${trimmed}?v=${encodeURIComponent(VERSION)}`;
  }

  // Expose small APP helper to global for modules to use (worklet loader, base)
  window.APP = window.APP || {};
  window.APP.BASE = BASE;
  window.APP.VERSION = VERSION;
  window.APP.addWorklet = async function(audioCtx, relPath){
    // relPath like "context/recorder-worklet.js"
    const url = moduleUrl(relPath);
    return audioCtx.audioWorklet.addModule(url);
  };

  // --- Module loading logic ---
  // We expect pages to be described in window.CONFIG.PAGES (array or map). But be robust:
  // If CONFIG.PAGES is array of { id, module } or map { id: modulePath } we'll handle both.
  const PAGES = normalizePages(CONFIG.PAGES || []);

  function normalizePages(pages) {
    // possible shapes:
    // 1) array: [{ id: "context", title: "...", module: "context/index.js" }, ...]
    // 2) object: { context: "context/index.js", translate: "translate/index.js" }
    if (Array.isArray(pages)) {
      const map = {};
      for (const p of pages) {
        if (p && p.id && p.module) map[p.id] = p;
      }
      return map;
    } else if (typeof pages === "object") {
      const map = {};
      for (const k of Object.keys(pages)) {
        const v = pages[k];
        if (typeof v === "string") map[k] = { id: k, module: v, title: k };
        else if (v && v.module) map[k] = Object.assign({ id: k }, v);
      }
      return map;
    }
    return {};
  }

  // find default page: first key in PAGES or 'home'
  const DEFAULT_PAGE = Object.keys(PAGES)[0] || "home";

  // load module by its pageId
  async function loadPage(pageId) {
    const page = PAGES[pageId];
    if (!page) {
      showError(`Unknown page: ${pageId}. Available: ${Object.keys(PAGES).join(", ")}`);
      return;
    }
    const modulePath = page.module;
    if (!modulePath) {
      showError(`Page ${pageId} has no module defined`);
      return;
    }

    showLoading(`Loading ${page.title || pageId}…`);

    const url = moduleUrl(modulePath);

    try {
      // dynamic import (ESM). servers must serve module with correct MIME type.
      const mod = await import(url);
      // Module can export:
      // - render(mount) async function
      // - default function(mount)
      // - or an object with .render
      if (mod && typeof mod.render === "function") {
        await mod.render(mount);
      } else if (typeof mod.default === "function") {
        await mod.default(mount);
      } else if (mod && typeof mod.init === "function") {
        // legacy: init takes mount
        await mod.init(mount);
      } else {
        // fallback: try to call exported 'main'
        if (typeof mod.main === "function") {
          await mod.main(mount);
        } else {
          // nothing callable — inject module as script tag? no — show error
          showError(`Модуль ${modulePath} загружен, но не экспортирует render/default/init/main`);
        }
      }
    } catch (err) {
      // try to provide more info: maybe server served non-module (404 HTML)
      showError(err && err.message ? err.message : String(err));
    }
  }

  // Router: hash-based. Examples: #/context, #/translate
  function getPageIdFromHash() {
    const h = (location.hash || "").replace(/^#/, "");
    // accept both "#/context" and "#context"
    const p = h.replace(/^\//, "");
    return p || DEFAULT_PAGE;
  }

  // Sync UI with hash
  async function handleHashChange() {
    const pageId = getPageIdFromHash();
    await loadPage(pageId);
    // update active menu item if menu provides a hook (non-invasive)
    if (window.updateMenuActive) {
      try { window.updateMenuActive(pageId); } catch {}
    }
  }

  // init: attach hash listener and load initial page
  window.addEventListener("hashchange", handleHashChange, false);

  // initial load (on DOMContentLoaded if needed)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      handleHashChange();
      attachMenuLinks();
    });
  } else {
    handleHashChange();
    attachMenuLinks();
  }

  // Attach simple event delegation for menu links (if you render menu with <a data-page="...">)
  function attachMenuLinks() {
    document.body.addEventListener("click", (ev) => {
      const a = ev.target.closest && ev.target.closest("[data-page]");
      if (!a) return;
      const pageId = a.getAttribute("data-page");
      if (!pageId) return;
      ev.preventDefault();
      location.hash = `#/${pageId}`;
    });
  }

  // expose loader for manual use
  window.SV = window.SV || {};
  window.SV.loadPage = loadPage;
  window.SV.pages = PAGES;
  window.SV.config = CONFIG;

  // tiny helpful log
  console.log("Loader ready. Pages:", Object.keys(PAGES).join(", ") || "(none declared). Use CONFIG.PAGES to declare.)");
})();
