/* ============================================================
   SMARTID INIT — ФИНАЛЬНАЯ ВЕРСИЯ c LOCALSTORAGE + MENU
   ============================================================ */

(() => {

  // ------------------------------------------------------------
  // 1) Создаём SMART_SESSION как раньше
  // ------------------------------------------------------------
  if (!window.SMART_SESSION) {
    const session = {
      authenticated: false,
      level: 1,
      email: null,
      user_id: null,
      name: null,
      loading: true,
      ready: null,
      _resolve: null,
    };

    session.ready = new Promise((resolve) => {
      session._resolve = resolve;
    });

    window.SMART_SESSION = session;
  }

  const session = window.SMART_SESSION;


  // ------------------------------------------------------------
  // 2) Восстанавливаем данные из localStorage (мгновенно)
  // ------------------------------------------------------------
  const ls_auth  = localStorage.getItem("sv_authenticated");
  const ls_uid   = localStorage.getItem("sv_user_id");
  const ls_email = localStorage.getItem("sv_email");
  const ls_name  = localStorage.getItem("sv_name");
  const ls_level = localStorage.getItem("sv_level");

  if (ls_auth === "yes" && ls_uid) {
    session.authenticated = true;
    session.user_id = ls_uid;
    session.email   = ls_email;
    session.name    = ls_name;
    session.level   = parseInt(ls_level || "1");
    session.loading = false;
  }


  // ------------------------------------------------------------
  // 3) Грузим сессию с сервера (НЕ блокирует работу)
  // ------------------------------------------------------------
  async function loadSessionFromServer() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });

      if (res.ok) {
        const data = await res.json();

        if (data?.loggedIn) {
          session.authenticated = true;
          session.level = data.level ?? 1;
          session.user_id = data.user?.id ?? null;
          session.email   = data.user?.email ?? null;
          session.name    = data.user?.name ?? null;

          // 🔥 сохраняем в localStorage
          localStorage.setItem("sv_authenticated", "yes");
          localStorage.setItem("sv_user_id", session.user_id);
          localStorage.setItem("sv_email", session.email || "");
          localStorage.setItem("sv_name", session.name || "");
          localStorage.setItem("sv_level", session.level.toString());
        } 
        else {
          clearLocal();
        }

      } else {
        clearLocal();
      }

    } catch (err) {
      console.warn("SmartID /auth/me error:", err);
    }

    session.loading = false;

    // завершаем promise ready — оставляем для твоего кода
    if (typeof session._resolve === "function") {
      session._resolve(session);
      session._resolve = null;
    }

    // 🔥 событие — пусть остаётся (vision старые версии используют)
    document.dispatchEvent(new Event("SMART_SESSION_READY"));
  }


  // ------------------------------------------------------------
  // 4) Очистка localStorage (logout)
  // ------------------------------------------------------------
  function clearLocal() {
    session.authenticated = false;
    session.user_id = null;
    session.email = null;
    session.name = null;
    session.level = 1;

    localStorage.removeItem("sv_authenticated");
    localStorage.removeItem("sv_user_id");
    localStorage.removeItem("sv_email");
    localStorage.removeItem("sv_name");
    localStorage.removeItem("sv_level");
  }


  // ------------------------------------------------------------
  // 5) Инициализация: сначала localStorage, потом сервер
  // ------------------------------------------------------------
  loadSessionFromServer().then(initLayout);


  // ------------------------------------------------------------
  // 6) Инициализация меню/топбара/футера
  //    (оставляем полностью как у тебя было!)
  // ------------------------------------------------------------
  async function initLayout() {

    await session.ready;

    import('/js/topbar.module.js')
      .then(mod => {
        mod.renderTopbar(session);      // ← как было
        mod.renderMenu(session.level);  // ← как было
        mod.initMenuControls();         // ← как было
      })
      .catch(err => console.error("Ошибка загрузки topbar:", err));

    import('/js/footer.js')
      .then(mod => mod.renderFooter())
      .catch(err => console.error("Ошибка загрузки footer:", err));
  }


  // ------------------------------------------------------------
  // 7) Logout — теперь ещё и чистим localStorage
  // ------------------------------------------------------------
  window.SV_LOGOUT = async function () {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {}

    clearLocal();
    location.href = '/index.html';
  };

})();
