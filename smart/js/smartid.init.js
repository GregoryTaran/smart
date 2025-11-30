/* ============================================================
   SMARTID INIT — УЛУЧШЕННАЯ СХЕМА:
   1) МГНОВЕННЫЙ TOPBAR ПО LOCALSTORAGE
   2) ПОТОМ СИНХРОНИЗАЦИЯ С СЕРВЕРОМ
   ============================================================ */

(() => {

  // ------------------------------------------------------------
  // 1) Создаём глобальную session (как и раньше)
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

    session.ready = new Promise(resolve => session._resolve = resolve);
    window.SMART_SESSION = session;
  }

  const session = window.SMART_SESSION;


  // ------------------------------------------------------------
  // 2) Восстанавливаем мгновенно LocalStorage → session
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
  // 3) МГНОВЕННЫЙ рендер TOPBAR + MENU по LocalStorage
  // ------------------------------------------------------------
  import('/js/topbar.module.js')
    .then(mod => {
      mod.renderTopbar(session);      // быстрый рендер до сервера
      mod.renderMenu(session.level);
      mod.initMenuControls();
    })
    .catch(err => console.error("Fast Topbar error:", err));



  // ------------------------------------------------------------
  // 4) Загружаем сессию с сервера (НЕ блокирует UI)
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

          // обновляем LС
          localStorage.setItem("sv_authenticated", "yes");
          localStorage.setItem("sv_user_id", session.user_id);
          localStorage.setItem("sv_email", session.email || "");
          localStorage.setItem("sv_name", session.name || "");
          localStorage.setItem("sv_level", session.level.toString());
        
        } else {
          clearLocal();
        }
      } else {
        clearLocal();
      }

    } catch (err) {
      console.warn("SmartID /auth/me error:", err);
    }

    session.loading = false;

    if (typeof session._resolve === "function") {
      session._resolve(session);
      session._resolve = null;
    }

    document.dispatchEvent(new Event("SMART_SESSION_READY"));
  }



  // ------------------------------------------------------------
  // 5) Очистка localStorage (logout helper)
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
  // 6) После сервера → корректирующий рендер
  // ------------------------------------------------------------
  loadSessionFromServer().then(initLayout);

  async function initLayout() {
    await session.ready;

    import('/js/topbar.module.js')
      .then(mod => {
        mod.renderTopbar(session);      // финальный рендер по серверу
        mod.renderMenu(session.level);
        mod.initMenuControls();
      })
      .catch(err => console.error("Topbar final error:", err));

    import('/js/footer.js')
      .then(mod => mod.renderFooter())
      .catch(err => console.error("Footer error:", err));
  }


  // ------------------------------------------------------------
  // 7) Глобальный logout: безопасный и мгновенный
  // ------------------------------------------------------------
  window.SV_LOGOUT = async function () {
    // 1) мгновенно чистим localStorage + session
    clearLocal();

    // 2) отправляем logout на сервер (фоново)
    try {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}

    // 3) редирект
    location.href = '/index.html';
  };

})();
