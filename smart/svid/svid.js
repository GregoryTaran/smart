// SMART/js/svid.js
// Минимальный клиентский модуль SVID (без cookies). Работает только с localStorage.
// События: 'svid:ready', 'svid:levelChanged', 'svid:loggedIn', 'svid:loggedOut'

const LS = window.localStorage;

// Ключи хранилища
const K = {
  VISITOR_ID: "svid.visitor_id",
  LEVEL: "svid.level",       // 1..5
  USER_ID: "svid.user_id",   // опц.
  MENU_CACHE: "svid.menu_cache", // опц. для кэша меню
  FLAGS: "svid.flags"        // опц.
};

const API = {
  INIT: "/identity/visitor/init",
  MENU: "/identity/menu",
  ME:   "/identity/me",
  HB:   "/identity/visitor/heartbeat"
};

// Утилиты
function getLevel() {
  const lvl = parseInt(LS.getItem(K.LEVEL) || "1", 10);
  return Number.isFinite(lvl) ? lvl : 1;
}

function setLevel(level) {
  const prev = getLevel();
  LS.setItem(K.LEVEL, String(level));
  if (prev !== level) {
    document.dispatchEvent(new CustomEvent("svid:levelChanged", { detail: { from: prev, to: level } }));
  }
}

function ensureVisitorId() {
  return LS.getItem(K.VISITOR_ID);
}

async function initVisitor() {
  const r = await fetch(API.INIT, { method: "POST" });
  if (!r.ok) throw new Error(`visitor.init failed: ${r.status}`);
  const j = await r.json();
  if (j.visitor_id) LS.setItem(K.VISITOR_ID, j.visitor_id);
  setLevel(j.level ?? 1);
  document.dispatchEvent(new CustomEvent("svid:ready", { detail: j }));
  return j;
}

async function fetchMenu() {
  const r = await fetch(API.MENU);
  if (!r.ok) throw new Error(`menu fetch failed: ${r.status}`);
  const j = await r.json(); // { items: [...] }
  try { LS.setItem(K.MENU_CACHE, JSON.stringify(j)); } catch {}
  return j;
}

// Простейший рендер меню (если на странице есть контейнер с data-svid-menu)
function renderMenu(menu) {
  const el = document.querySelector("[data-svid-menu]");
  if (!el || !menu?.items) return;

  const level = getLevel();
  el.innerHTML = ""; // очистка
  const ul = document.createElement("ul");

  menu.items
    .filter(it => (it.req_level ?? 1) <= level)
    .forEach(it => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = it.href || "#";
      a.textContent = it.title || it.id || "item";
      li.appendChild(a);
      ul.appendChild(li);
    });

  el.appendChild(ul);
  document.dispatchEvent(new CustomEvent("svid:menuRendered", { detail: { level, items: menu.items.length } }));
}

// Публичное API для интеграции с Supabase-логином
window.SVID = {
  get state() {
    return {
      visitor_id: LS.getItem(K.VISITOR_ID),
      user_id: LS.getItem(K.USER_ID),
      level: getLevel(),
      flags: safeJsonGet(K.FLAGS, {})
    };
  },

  // Вызови это после удачной аутентификации Supabase
  // Пример: SVID.setUser({ user_id: supa.user.id, level: 2, flags: {...}, supabase: {...} })
  setUser({ user_id, level = 2, flags, supabase } = {}) {
    if (user_id) LS.setItem(K.USER_ID, user_id);
    if (flags)   safeJsonSet(K.FLAGS, flags);
    if (supabase) safeJsonSet("svid.supabase", supabase); // «всё то, что даёт супабейз»
    setLevel(level);
    document.dispatchEvent(new CustomEvent("svid:loggedIn", { detail: { user_id, level } }));
    // Обновим меню под новый уровень
    fetchMenu().then(renderMenu).catch(console.warn);
  },

  // Полный выход до гостя (level=1). visitor_id оставляем, чтобы не терять аналитику.
  logout() {
    LS.removeItem(K.USER_ID);
    LS.removeItem(K.FLAGS);
    safeJsonSet("svid.supabase", null);
    setLevel(1);
    document.dispatchEvent(new CustomEvent("svid:loggedOut"));
    fetchMenu().then(renderMenu).catch(console.warn);
  }
};

// Безопасные JSON-хелперы
function safeJsonGet(key, fallback) {
  try { const v = LS.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function safeJsonSet(key, obj) {
  try {
    if (obj === null || obj === undefined) { LS.removeItem(key); return; }
    LS.setItem(key, JSON.stringify(obj));
  } catch {}
}

// Автозапуск
(async function boot() {
  try {
    if (!ensureVisitorId()) await initVisitor();
    // На старте подтянем меню (даже если пользователь уже авторизован и level>1 — фронт это знает)
    const menu = await fetchMenu();
    renderMenu(menu);
  } catch (e) {
    console.warn("[SVID] boot error:", e);
  }
})();

