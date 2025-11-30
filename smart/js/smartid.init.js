/* ================================================
   SMARTID INIT — финальная стабильная версия
   ================================================ */

(() => {

  // ----------------------------------------------
  // 1) Создаём SMART_SESSION, если его ещё нет
  // ----------------------------------------------

  if (!window.SMART_SESSION) {
    const session = {
      authenticated: false,
      level: 1,
      email: null,
      user_id: null,
      name: null,
      loading: true,
      ready: null,
      _resolve: null
    };

    session.ready = new Promise((resolve) => {
      session._resolve = resolve;
    });

    window.SMART_SESSION = session;
  }

  const session = window.SMART_SESSION;


  // ----------------------------------------------
  // 2) Функция загрузки /api/auth/me
  // ----------------------------------------------

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
        } else {
          session.authenticated = false;
          session.level = 1;
          session.user_id = null;
          session.email = null;
          session.name = null;
        }
      } else {
        session.authenticated = false;
      }
    } catch (e) {
      console.warn("SmartID /auth/me error:", e);
      session.authenticated = false;
    }

    session.loading = false;

    if (typeof session._resolve === 'function') {
      session._resolve(session);
      session._resolve = null;
    }

    // 🔥 ДОБАВЛЕНО — запускает vision.js и vision_list.js
    document.dispatchEvent(new Event("SMART_SESSION_READY"));
  }


  // ----------------------------------------------
  // 3) Если данные уже были — НЕ спрашиваем сервер
  // ----------------------------------------------

  if (session.loading === false) {
    initLayout();
  } 
  else {
    loadSessionFromServer().then(initLayout);
  }


  // ----------------------------------------------
  // 4) Загружаем topbar + menu + footer после session
  // ----------------------------------------------

  async function initLayout() {

    await session.ready;

    import('/js/topbar.module.js')
      .then(mod => {
        mod.renderTopbar(session);
        mod.renderMenu(session.level);
        mod.initMenuControls();
      })
      .catch(err => console.error("Ошибка загрузки topbar:", err));

    import('/js/footer.js')
      .then(mod => mod.renderFooter())
      .catch(err => console.error("Ошибка загрузки footer:", err));
  }


  // ----------------------------------------------
  // 5) Logout
  // ----------------------------------------------

  window.SV_LOGOUT = async function () {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {}
    location.href = 'index.html';
  };

})();
