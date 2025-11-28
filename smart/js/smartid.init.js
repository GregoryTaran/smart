// smartid.init.js — FIXED

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
    console.warn('SmartID error:', e);
  }

  // ГЛОБАЛЬНО ХРАНИМ
  window.SMART_SESSION = session;

  // ПРАВИЛЬНЫЕ ПУТИ!!!
  import('/js/topbar.module.js').then(m => {
    m.renderTopbar(session);
    m.renderMenu(session.level);
  });

  import('/js/footer.js').then(m => {
    m.renderFooter(session);
  });

})();
