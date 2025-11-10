/* SMART VISION — menu-state.js (fresh)
   Единый менеджер авторизации и меню.

   LocalStorage:
     sv_auth     : "loggedIn" | (нет)
     sv_user     : JSON res.user_merged
     sv_user_raw : JSON res.user_auth
     sv_profile  : JSON res.user_profile | null

   Разметка:
     - Хедер: <a id="auth-link" class="login-link" href="login/login.html#login">Логин</a>
     - Меню:  <nav class="menu"><ul> <li data-show="guest, auth, admin" data-role="admin?">...</li> ... </ul></nav>
       data-show перечисляет, кому видно (через запятую): guest | auth | admin | user | * (всем)
       data-role (опц.) — требует точного совпадения роли (admin, user и т.п.)
*/

(function () {
  // ======= Storage keys
  const LS_AUTH     = "sv_auth";
  const LS_USER     = "sv_user";
  const LS_USER_RAW = "sv_user_raw";
  const LS_PROFILE  = "sv_profile";

  // ======= Helpers
  const ls = {
    get(k){ try { return localStorage.getItem(k); } catch { return null; } },
    set(k,v){ try { localStorage.setItem(k,v); } catch {} },
    remove(k){ try { localStorage.removeItem(k); } catch {} }
  };
  const parseJSON = (s, d=null)=>{ try { return s?JSON.parse(s):d; } catch { return d; } };
  const isLoggedIn = ()=> ls.get(LS_AUTH) === "loggedIn";
  const getUser    = ()=> parseJSON(ls.get(LS_USER), null);

  const q  = (sel, root=document)=> root.querySelector(sel);
  const qa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

  // ======= Roles
  // user_merged формируется на сервере; поле role берём оттуда. :contentReference[oaicite:3]{index=3}
  function currentRoles(user) {
    const set = new Set();
    if (user && user.id) {
      set.add("auth");
      // допускаем single role или массив roles
      if (user.role)  set.add(String(user.role).toLowerCase());
      if (Array.isArray(user.roles)) {
        user.roles.forEach(r => r && set.add(String(r).toLowerCase()));
      }
    } else {
      set.add("guest");
    }
    return set;
  }

  function parseAllowedRoles(attr) {
    if (!attr) return null;            // null => показывать всем
    const list = String(attr).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return null;
    return new Set(list);
  }

  // ======= Topbar auth-link
  function applyTopbarAuthLink(loggedIn) {
    const a = document.getElementById("auth-link") || q(".login-link");
    if (!a) return;
    if (loggedIn) {
      a.textContent = "Выйти";
      a.href = "#logout";
      a.dataset.action = "logout";
      a.classList.add("is-logged");
    } else {
      a.textContent = "Логин";
      a.href = "login/login.html#login";
      a.removeAttribute("data-action");
      a.classList.remove("is-logged");
    }
  }

  // ======= Menu visibility by data attrs
  function applyMenuVisibilityByAttrs(user) {
    const sidebar = document.getElementById("sidebar");
    const menuRoot = q("nav.menu", sidebar || document);
    if (!menuRoot) return false; // меню не найдено

    const roles = currentRoles(user);
    let hadDirectives = false;

    qa("[data-show]", menuRoot).forEach(el => {
      const allowed = parseAllowedRoles(el.getAttribute("data-show")); // Set | null
      const needRole = (el.getAttribute("data-role") || "").toLowerCase() || null;

      if (allowed) hadDirectives = true;

      let visible = true;
      if (allowed && !allowed.has("*")) {
        // Нужна хотя бы одна роль из allowed
        visible = [...allowed].some(r => roles.has(r));
      }
      if (visible && needRole) {
        visible = roles.has(needRole);
      }
      // Используем hidden (семантика), можно заменить на classList.toggle('is-hidden', !visible)
      el.hidden = !visible;
    });

    return hadDirectives;
  }

  // ======= Fallback (если в menu.html нет data-show)
  function applyMenuFallback(loggedIn, user) {
    const menuList = q("nav.menu ul");
    if (!menuList) return;

    // скрыть пункт «Вход/регистрация»
    const loginLink = q('nav.menu a[href="login/login.html"], nav.menu a[data-id="login"]');
    if (loginLink && loginLink.closest("li")) {
      loginLink.closest("li").style.display = loggedIn ? "none" : "";
    }

    // убрать ранее добавленные динамические
    qa("li[data-dynamic='1']", menuList).forEach(li => li.remove());

    if (loggedIn) {
      // Профиль
      const liProfile = document.createElement("li");
      liProfile.dataset.dynamic = "1";
      const aProfile = document.createElement("a");
      aProfile.href = "profile/profile.html";
      aProfile.textContent = user && user.name ? `Профиль (${user.name})` : "Профиль";
      liProfile.appendChild(aProfile);
      menuList.appendChild(liProfile);

      // Выйти
      const liLogout = document.createElement("li");
      liLogout.dataset.dynamic = "1";
      const aLogout = document.createElement("a");
      aLogout.href = "#logout";
      aLogout.textContent = "Выйти";
      aLogout.dataset.action = "logout";
      liLogout.appendChild(aLogout);
      menuList.appendChild(liLogout);
    }
  }

  // ======= Apply full UI
  function applyUI() {
    const loggedIn = isLoggedIn();
    const user = getUser();

    applyTopbarAuthLink(loggedIn);

    const directivesApplied = applyMenuVisibilityByAttrs(user);
    if (!directivesApplied) {
      applyMenuFallback(loggedIn, user);
    }
  }

  // ======= Server sync
  async function fetchMeAndSync() {
    try {
      const res = await fetch("/api/auth/me", { method: "GET", credentials: "include" });
      if (!res.ok) throw new Error("me failed");
      const data = await res.json();

      if (data && data.loggedIn) {
        ls.set(LS_AUTH, "loggedIn");
        if (data.user_merged)  ls.set(LS_USER, JSON.stringify(data.user_merged));
        if (data.user_auth)    ls.set(LS_USER_RAW, JSON.stringify(data.user_auth));
        if ("user_profile" in data) ls.set(LS_PROFILE, JSON.stringify(data.user_profile));
      } else {
        ls.remove(LS_AUTH); ls.remove(LS_USER); ls.remove(LS_USER_RAW); ls.remove(LS_PROFILE);
      }
      applyUI();
    } catch {
      // Сервер не ответил — остаёмся на локальном стейте
      applyUI();
    }
  }

  async function doLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    ls.remove(LS_AUTH); ls.remove(LS_USER); ls.remove(LS_USER_RAW); ls.remove(LS_PROFILE);
    applyUI();
  }

  // ======= Bindings
  function bindGlobal() {
    // logout по data-action
    document.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-action='logout']");
      if (a) { ev.preventDefault(); doLogout(); }
    }, { passive: false });

    // синк между вкладками
    window.addEventListener("storage", (e) => {
      if (!e || ![LS_AUTH, LS_USER, LS_USER_RAW, LS_PROFILE].includes(e.key)) return;
      applyUI();
    });
  }

  // Ждём подгрузки меню (menu.html) и топбара
  function whenMenuReady(cb) {
    const ready = !!(q("#topbar") && q("nav.menu"));
    if (ready) { cb(); return; }

    const obs = new MutationObserver(() => {
      if (q("#topbar") && q("nav.menu")) {
        obs.disconnect(); cb();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // страховка — через 5с применить всё равно
    setTimeout(() => { try { cb(); } catch {} }, 5000);
  }

  // ======= Init
  function init() {
    bindGlobal();
    applyUI();            // мгновенно по локалу
    whenMenuReady(applyUI); // повторить, когда меню реально появится
    fetchMeAndSync();     // подтянуть истину с сервера (/api/auth/me)
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // debug API (опц.)
  window.SVAuth = {
    get user() { return getUser(); },
    get loggedIn() { return isLoggedIn(); },
    refresh: fetchMeAndSync,
    logout: doLogout
  };
})();
