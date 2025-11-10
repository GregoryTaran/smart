/* SMART VISION — menu-state.js (full)
   Менеджер состояния меню/топбара на всех страницах.

   LocalStorage:
     sv_auth     : "loggedIn" | (нет)
     sv_user     : JSON res.user_merged
     sv_user_raw : JSON res.user_auth
     sv_profile  : JSON res.user_profile | null

   Разметка:
     - topbar:   <a id="auth-link" class="login-link" href="login/login.html#login">Логин</a>
     - меню:     <nav class="menu"><ul>...<li data-show="guest|auth|all" data-role="admin?">...</li></ul></nav>
                  (если data-show не расставлен — скрипт применит фолбэк-логику)
*/

(function () {
  // ===== Keys
  const LS_AUTH     = "sv_auth";
  const LS_USER     = "sv_user";
  const LS_USER_RAW = "sv_user_raw";
  const LS_PROFILE  = "sv_profile";

  // ===== Utils
  const ls = {
    get(k){ try { return localStorage.getItem(k); } catch { return null; } },
    set(k,v){ try { localStorage.setItem(k,v); } catch {} },
    remove(k){ try { localStorage.removeItem(k); } catch {} }
  };
  const parseJSON = (s, d=null)=>{ try { return s?JSON.parse(s):d; } catch { return d; } };
  const isLoggedIn = ()=> ls.get(LS_AUTH) === "loggedIn";
  const getUser    = ()=> parseJSON(ls.get(LS_USER), null);

  // ===== DOM helpers
  const q  = (sel, root=document)=> root.querySelector(sel);
  const qa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

  // ===== Topbar control
  function updateTopbar(loggedIn) {
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

  // ===== Menu control (primary: data-show / data-role)
  function applyMenuByAttributes(loggedIn, role) {
    const items = qa("nav.menu li");
    if (!items.length) return false; // сигнал: меню не найдено

    let hasDirective = false;
    for (const li of items) {
      const show = (li.dataset && li.dataset.show) || null; // "guest"|"auth"|"all"|null
      if (show) hasDirective = true;
      const needRole = (li.dataset && li.dataset.role) || null;

      // если метки нет — потом обработаем фолбэком
      if (!show) continue;

      let visible = false;
      if (show === "all") visible = true;
      else if (show === "guest") visible = !loggedIn;
      else if (show === "auth") visible = loggedIn;

      if (visible && needRole) {
        visible = !!(role && role.toLowerCase() === String(needRole).toLowerCase());
      }
      li.style.display = visible ? "" : "none";
    }
    return hasDirective; // true — атрибуты есть и применены
  }

  // ===== Fallback (если в menu.html нет data-show)
  // Скрываем "Вход/регистрация" при loggedIn, добавляем Профиль/Выйти динамически
  function applyMenuFallback(loggedIn, user) {
    const menuList = q("nav.menu ul");
    if (!menuList) return;

    // Удалить добавленные ранее динамические элементы
    qa("li[data-dynamic='1']", menuList).forEach(li => li.remove());

    // Скрыть/показать login пункт (ищем по href/ data-id)
    const loginLink = q('nav.menu a[href="login/login.html"], nav.menu a[data-id="login"]');
    if (loginLink && loginLink.closest("li")) {
      loginLink.closest("li").style.display = loggedIn ? "none" : "";
    }

    if (loggedIn) {
      // Профиль
      const liProfile = document.createElement("li");
      liProfile.dataset.dynamic = "1";
      const aProfile = document.createElement("a");
      aProfile.href = "profile/profile.html";
      const u = user || {};
      aProfile.textContent = u && u.name ? `Профиль (${u.name})` : "Профиль";
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

  // ===== Apply full UI from state
  function applyUIFromState() {
    const loggedIn = isLoggedIn();
    const user = getUser();
    const role = user && user.role ? String(user.role) : null;

    updateTopbar(loggedIn);

    // Сначала пробуем «правильный» способ через data-show/data-role
    const directivesApplied = applyMenuByAttributes(loggedIn, role);

    // Если в вёрстке нет data-show — используем фолбэк совместимости
    if (!directivesApplied) {
      applyMenuFallback(loggedIn, user);
    }
  }

  // ===== Server sync
  async function fetchMeAndSync() {
    try {
      const res = await fetch("/api/auth/me", { method: "GET", credentials: "include" });
      if (!res.ok) throw new Error("me failed");
      const data = await res.json();

      if (data && data.loggedIn) {
        ls.set(LS_AUTH, "loggedIn");
        if (data.user_merged)  ls.set(LS_USER, JSON.stringify(data.user_merged));
        if (data.user_auth)    ls.set(LS_USER_RAW, JSON.stringify(data.user_auth));
        if (typeof data.user_profile !== "undefined")
          ls.set(LS_PROFILE, JSON.stringify(data.user_profile));
      } else {
        ls.remove(LS_AUTH);
        ls.remove(LS_USER);
        ls.remove(LS_USER_RAW);
        ls.remove(LS_PROFILE);
      }
      applyUIFromState();
    } catch {
      // по нашей модели — ок, остаёмся на локальном состоянии
    }
  }

  async function doLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    ls.remove(LS_AUTH);
    ls.remove(LS_USER);
    ls.remove(LS_USER_RAW);
    ls.remove(LS_PROFILE);
    applyUIFromState();
  }

  // ===== Bindings
  function bindGlobal() {
    // Клик по logout
    document.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-action='logout']");
      if (a) {
        ev.preventDefault();
        doLogout();
      }
    }, { passive: false });

    // Синхронизация между вкладками
    window.addEventListener("storage", (e) => {
      if (e && [LS_AUTH, LS_USER, LS_USER_RAW, LS_PROFILE].includes(e.key)) {
        applyUIFromState();
      }
    });
  }

  // ===== Fragments readiness
  // fragment-load.js может вставлять topbar/menu уже ПОСЛЕ DOMContentLoaded.
  // Поэтому ждём появления #topbar и nav.menu.
  function whenFragmentsReady(cb) {
    const ready = !!(q("#topbar") && q("nav.menu"));
    if (ready) { cb(); return; }

    const obs = new MutationObserver(() => {
      if (q("#topbar") && q("nav.menu")) {
        obs.disconnect();
        cb();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // страховка: через 5с применим то, что есть
    setTimeout(() => { try { cb(); } catch {} }, 5000);
  }

  // ===== Init
  function init() {
    bindGlobal();
    // сразу применим локальное состояние (если фрагменты уже на месте — поменяется меню)
    applyUIFromState();
    // дождёмся вставки фрагментов и повторим
    whenFragmentsReady(() => applyUIFromState());
    // синхронизация с сервером
    fetchMeAndSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
