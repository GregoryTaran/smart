// smartid.init.js — новая версия, совместимая с твоим backend

(async () => {
  let session = {
    authenticated: false,
    level: 1,
    email: null,
    user_id: null
  };

  try {
    const r = await fetch('/api/auth/me', {
      credentials: 'include'
    });
    if (r.ok) {
      const data = await r.json();
      if (data.loggedIn) {
        session.authenticated = true;
        session.level = data.level;
        session.user_id = data.user_merged?.id || null;
        session.email = data.user_merged?.email || null;
      }
    }
  } catch (e) {
    console.warn('SmartID init error:', e);
  }

  // Глобально сохраняем сессию
  window.SMART_SESSION = session;

  // Рендерим интерфейс
  import('/smart/js/topbar.module.js').then(m => {
    m.renderTopbar(session);
    m.renderMenu(session.level);
  });

  import('/smart/js/footer.js').then(m => {
    m.renderFooter(session);
  });

})();
