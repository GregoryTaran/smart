/* ================================================
   SMARTID INIT – версия под SMART AUTH backend
   ================================================ */

(async () => {

  const session = {
    authenticated: false,
    level: 1,
    email: null,
    user_id: null
  };

  // 1) Получаем текущее состояние сессии
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
      }
    }
  } catch (e) {
    console.warn("SmartID /auth/me error:", e);
  }

  // Делаем сессию глобальной
  window.SMART_SESSION = session;


  // 2) TOPBAR / MENU
  import('/js/topbar.module.js')
    .then(mod => {
      mod.renderTopbar(session);
      mod.renderMenu(session.level);
      mod.initMenuControls();
    })
    .catch(err => console.error("Ошибка загрузки topbar:", err));


  // 3) FOOTER
  import('/js/footer.js')
    .then(mod => mod.renderFooter(session))
    .catch(err => console.error("Ошибка загрузки footer:", err));

})();
