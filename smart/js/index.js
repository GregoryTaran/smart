// index.js — resilient SPA loader (fixed fallback for empty CONFIG.PAGES)
// - если CONFIG.PAGES пуст, попытается загрузить /menu1.js, /context/index.js, /translate/index.js и т.п.
// - использует абсолютные пути от корня (BASE/)
// - удобные и понятные сообщения для разработчика (и немного юмора, потому что Грег любит шутки)
// Помести вместо старого smart/index.js

(function () {
  console.log("SMART VISION loader — ваш Бро в деле. Если я шучу — значит всё под контролем.");

  const CONFIG = window.CONFIG || {};
  const BASE = (CONFIG.BASE_URL ? String(CONFIG.BASE_URL).replace(/\/$/, '') : '') || '';
  const VERSION = CONFIG.VERSION || (new Date()).toISOString().slice(0,10);
  const MOUNT_ID = CONFIG.MOUNT_ID || "app";
  const mount = document.getElementById(MOUNT_ID) || createMount(MOUNT_ID);

  function createMount(id) {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
    return el;
  }

  function showLoading(text = "Loading…") {
    mount.innerHTML = `<div style="padding:18px;color:#444;font-family:Inter,system-ui,Segoe UI,Roboto,Arial;"><strong>${text}</strong></div>`;
  }
  function showErrorHtml(title, html) {
    mount.innerHTML = `<div style="padding:18px;color:#a00;background:#fff6f6;border-radius:8px;font-family:Inter,system-ui,Segoe UI,Roboto,Arial;">
      <strong>${escapeHtml(title)}</strong>
      <div style="margin-top:8px;color:#333">${html}</div>
      <div style="margin-top:8px;color:#666;font-size:13px">Если что — зови Бро (он рядом).</div>
    </div>`;
    console.error(title, html);
  }
  function showError(text) { showErrorHtml("Ошибка", escapeHtml(String(text))); }
  function escapeHtml(s){ return String(s||"").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function moduleUrl(modulePath) {
    const trimmed = String(modulePath || "").replace(/^\//, "");
    return `${BASE}/${trimmed}?v=${encodeURIComponent(VERSION)}`;
  }

  window.APP = window.APP || {};
  window.APP.BASE = BASE;
  window.APP.VERSION = VERSION;
  window.APP.addWorklet = async function(audioCtx, relPath){
    const url = moduleUrl(relPath);
    return audioCtx.audioWorklet.addModule(url);
  };

  // Normalize pages config into map { id: {id,module,title} }
  function normalizePages(pages) {
    if (!pages) return {};
    if (Array.isArray(pages)) {
      const map = {};
      for (const p of pages) if (p && p.id && p.module) map[p.id] = p;
      return map;
    }
    if (typeof pages === "object") {
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

  const PAGES = normalizePages(CONFIG.PAGES || {});
  const PAGE_IDS = Object.keys(PAGES);
  const DEFAULT_PAGE = PAGE_IDS[0] || null;

  async function dynamicImport(url) {
    // dynamic import with nicer error wrapping
    try {
      return await import(url);
    } catch (e) {
      throw e;
    }
  }

  async function loadModuleByPath(modulePath, pageInfo) {
    const url = moduleUrl(modulePath);
    showLoading(`Loading module ${pageInfo ? (pageInfo.title||pageInfo.id) : modulePath}…`);
    try {
      const mod = await dynamicImport(url);
      if (mod && typeof mod.render === "function") {
        await mod.render(mount);
        return true;
      } else if (typeof mod.default === "function") {
        await mod.default(mount);
        return true;
      } else if (mod && typeof mod.init === "function") {
        await mod.init(mount);
        return true;
      } else if (typeof mod.main === "function") {
        await mod.main(mount);
        return true;
      } else {
        throw new Error(`Модуль ${modulePath} загружен, но не экспортирует render/default/init/main`);
      }
    } catch (e) {
      throw e;
    }
  }

  async function tryFallbacks() {
    // Попробуем в порядке приоритетов загрузить что-то полезное:
    const tryList = [
      { path: "menu1.js", label: "menu1.js" },
      { path: "menu.js", label: "menu.js" },
      { path: "context/index.js", label: "context/index.js" },
      { path: "context/context.js", label: "context/context.js" },
      { path: "translate/index.js", label: "translate/index.js" },
      { path: "translator/index.js", label: "translator/index.js" },
      { path: "app.js", label: "app.js" }
    ];

    const tried = [];
    for (const t of tryList) {
      try {
        await loadModuleByPath(t.path, { title: t.label });
        return; // success -> done
      } catch (e) {
        tried.push({ path: t.path, error: e && e.message ? e.message : String(e) });
        // continue to next
      }
    }

    // If nothing удалось — выводим дружелюбный экран с подсказкой
    const triedHtml = tried.map(x => `<div><strong>${escapeHtml(x.path)}</strong> — ${escapeHtml(x.error)}</div>`).join("");
    showErrorHtml("Не удалось автоматически найти модуль.", `
      <div>Похоже, CONFIG.PAGES пуст или модули не найдены на стандартных путях.</div>
      <div style="margin-top:8px">Попытки загрузки модулей:</div>
      <div style="margin-top:8px">${triedHtml}</div>
      <div style="margin-top:12px">Решение: добавь <code>window.CONFIG.PAGES</code> в <code>config.js</code> или помести модуль меню <code>/menu1.js</code> или страницу <code>/context/index.js</code>.</div>
    `);
  }

  async function loadPageById(pageId) {
    const page = PAGES[pageId];
    if (!page) throw new Error(`Unknown page: ${pageId}`);
    if (!page.module) throw new Error(`Page ${pageId} has no module`);
    return await loadModuleByPath(page.module, page);
  }

  function getPageIdFromHash() {
    const h = (location.hash || "").replace(/^#/, "");
    const p = h.replace(/^\//, "");
    return p || null;
  }

  async function handleHashChange() {
    const pageId = getPageIdFromHash();
    if (pageId) {
      try {
        await loadPageById(pageId);
        if (window.updateMenuActive) try { window.updateMenuActive(pageId); } catch {}
        return;
      } catch (e) {
        // failed to load requested pageId -> show friendly error but try fallbacks
        console.warn("Failed to load pageId:", pageId, e);
        showErrorHtml(`Ошибка загрузки модуля`, `<div>Unknown page: ${escapeHtml(pageId)}.</div><div>Попытаюсь автопоиском...</div>`);
        await tryFallbacks();
        return;
      }
    }

    // no hash specified
    if (PAGE_IDS.length) {
      // load default configured page
      try {
        await loadPageById(DEFAULT_PAGE);
        if (window.updateMenuActive) try { window.updateMenuActive(DEFAULT_PAGE); } catch {}
        return;
      } catch (e) {
        console.warn("Failed to load default page:", DEFAULT_PAGE, e);
        showErrorHtml("Ошибка загрузки модуля", `Default page ${escapeHtml(String(DEFAULT_PAGE||""))} failed. Попытаюсь автопоиском...`);
        await tryFallbacks();
        return;
      }
    }

    // CONFIG.PAGES empty -> try sensible fallbacks
    await tryFallbacks();
  }

  // attach handlers
  window.addEventListener("hashchange", handleHashChange, false);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      handleHashChange();
      attachMenuLinks();
    });
  } else {
    handleHashChange();
    attachMenuLinks();
  }

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

  // expose API
  window.SV = window.SV || {};
  window.SV.loadPage = async (id) => {
    location.hash = `#/${id}`;
  };
  window.SV.pages = PAGES;
  window.SV.config = CONFIG;

  console.log("Loader ready. Pages:", Object.keys(PAGES).join(", ") || "(none declared). Trying fallbacks.)");
})();
