/* ================================================
   SMARTID INIT – финальная версия под SMART AUTH backend
   ================================================ */

(() => {
  // 1) Глобальная сессия
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

  // 2) Получаем текущее состояние сессии с сервера
  async function loadSession() {
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
      }
    } catch (e) {
      console.warn("SmartID /auth/me error:", e);
      session.authenticated = false;
      session.level = 1;
      session.user_id = null;
      session.email = null;
      session.name = null;
    }

    session.loading = false;
    if (typeof session._resolve === 'function') {
      session._resolve(session);
      session._resolve = null;
    }
  }

  // 3) TOPBAR / MENU
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
      .then(mod => mod.renderFooter(session))
      .catch(err => console.error("Ошибка загрузки footer:", err));
  }

  loadSession();
  initLayout();

  // 4) Глобальный logout (по желанию)
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
