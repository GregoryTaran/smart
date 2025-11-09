/* SMART VISION — menu-state.js
   Единый менеджер состояния меню/хедера на всех страницах.
   ЛОКАЛЬНОЕ СОСТОЯНИЕ (LocalStorage):
     - sv_auth   : "loggedIn" | (отсутствует)
     - sv_user   : JSON компактного профиля (res.user_merged)
     - sv_user_raw : JSON полного Supabase-профиля (res.user_auth)
     - sv_profile  : JSON профиля из БД (res.user_profile) или null
*/

(function () {
  const LS_AUTH   = "sv_auth";
  const LS_USER   = "sv_user";
  const LS_USER_RAW = "sv_user_raw";
  const LS_PROFILE  = "sv_profile";

  // --- U T I L S ---
  const ls = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    set(key, val) {
      try { window.localStorage.setItem(key, val); } catch {}
    },
    remove(key) {
      try { window.localStorage.removeItem(key); } catch {}
    }
  };

  function parseJson(str, fallback = null) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function currentAuth() {
    return ls.get(LS_AUTH) === "loggedIn";
  }
  function currentUser() {
    return parseJson(ls.get(LS_USER), null);
  }

  // --- A P P L Y   U I ---
  function applyUIFromState() {
    const loggedIn = currentAuth();
    const user = currentUser(); // может быть null

    // 1) ТОПБАР: правый край — "Логин" ↔ "Выйти"
    //   Предпочтительно иметь <a id="auth-link" ...>, fallback — .login-link
    const authLink = document.getElementById("auth-link") || document.querySelector(".login-link");
    if (authLink) {
      if (loggedIn) {
        authLink.textContent = "Выйти";
        authLink.href = "#logout";
        authLink.dataset.action = "logout";
        authLink.classList.add("is-logged");
      } else {
        authLink.textContent = "Логин";
        authLink.href = "login/login.html#login";
        authLink.removeAttribute("data-action");
        authLink.classList.remove("is-logged");
      }
    }

    // 2) ЛЕВОЕ МЕНЮ: скрыть/показать пункт «Вход/регистрация»
    //   В твоём menu.html у этого пункта href="login/login.html"
    const loginItem = document.querySelector('nav.menu a[href="login/login.html"], nav.menu a[data-id="login"]');
    if (loginItem && loginItem.closest("li")) {
      loginItem.closest("li").style.display = loggedIn ? "none" : "";
    }

    // (опц.) 3) Добавлять пункт "Профиль" и "Выйти" внутрь меню, если нужно
    //   Чтобы не дублировать — сначала уберём те, что уже добавляли ранее
    const menuList = document.querySelector("nav.menu ul");
    if (menuList) {
      // Удалим наши динамические элементы, чтобы не плодились при повторном рендере
      menuList.querySelectorAll("li[data-dynamic='1']").forEach(li => li.remove());

      if (loggedIn) {
        // Профиль
        const liProfile = document.createElement("li");
        liProfile.dataset.dynamic = "1";
        const aProfile = document.createElement("a");
        aProfile.href = "profile/profile.html";
        aProfile.textContent = user && user.name ? `Профиль (${user.name})` : "Профиль";
        liProfile.appendChild(aProfile);
        menuList.appendChild(liProfile);

        // Выход (как пункт меню)
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

    // 4) (опц.) Аватар/имя в топбаре
    //   Если в макете появится место, можно сюда добавить отрисовку аватара
    //   из user.avatar (URL) и подпись user.email/user.name.
  }

  // --- S Y N C   W I T H   S E R V E R ---
  async function fetchMeAndSync() {
    try {
      const res = await fetch("/api/auth/me", { method: "GET", credentials: "include" });
      if (!res.ok) throw new Error("me failed");
      const data = await res.json();

      if (data && data.loggedIn) {
        // Пишем максимум, как договаривались
        ls.set(LS_AUTH, "loggedIn");
        if (data.user_merged)  ls.set(LS_USER, JSON.stringify(data.user_merged));
        if (data.user_auth)    ls.set(LS_USER_RAW, JSON.stringify(data.user_auth));
        if (typeof data.user_profile !== "undefined")
          ls.set(LS_PROFILE, JSON.stringify(data.user_profile));
      } else {
        // Нет логина
        ls.remove(LS_AUTH);
        ls.remove(LS_USER);
        ls.remove(LS_USER_RAW);
        ls.remove(LS_PROFILE);
      }
      applyUIFromState();
    } catch (e) {
      // Сервер не ответил — оставляем текущее локальное состояние
      // (по твоей философии — это нормально)
      // Можем тихо промолчать
      // console.warn("auth/me error", e);
    }
  }

  async function doLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    // Чистим локал-стейт в любом случае
    ls.remove(LS_AUTH);
    ls.remove(LS_USER);
    ls.remove(LS_USER_RAW);
    ls.remove(LS_PROFILE);
    applyUIFromState();
  }

  // --- B I N D I N G S ---
  function bindGlobalClicks() {
    // Ловим клики по элементам с data-action="logout"
    document.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-action='logout']");
      if (a) {
        ev.preventDefault();
        doLogout();
      }
    }, { passive: false });
  }

  // --- I N I T ---
  function initMenuState() {
    // 1) Сразу применяем то, что в LocalStorage (мгновенно)
    applyUIFromState();

    // 2) Подписки
    bindGlobalClicks();

    // 3) Синхронизация с сервером (подтвердить или скорректировать локальное состояние)
    fetchMeAndSync();
  }

  // Запуск после вставки фрагментов (menu/topbar уже на странице)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMenuState);
  } else {
    initMenuState();
  }
})();

