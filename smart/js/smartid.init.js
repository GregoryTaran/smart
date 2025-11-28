// ===============================
// SMARTID INIT – ФИНАЛЬНАЯ ВЕРСИЯ
// ===============================

(async () => {
  // Базовая структура сессии
  const session = {
    authenticated: false,
    level: 1,
    email: null,
    user_id: null
  };

  // -------------------------------
  // 1) Пытаемся получить текущую сессию
  // -------------------------------
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'include'
    });

    if (res.ok) {
      const data = await res.json();

      if (data?.loggedIn) {
        session.authenticated = true;
        session.level = data.level ?? 1;
        session.user_id = data.user_merged?.id ?? null;
        session.email = data.user_merged?.email ?? null;
      }
    }
  } catch (e) {
    console.warn('SmartID /auth/me error:', e);
  }

  // Сохраняем глобально
  window.SMART_SESSION = session;

  // -------------------------------
  // 2) Загружаем TOPBAR
  // -------------------------------
  import('/js/topbar.module.js')
    .then(mod => {
      mod.renderTopbar(session);      // ← создаёт topbar-inner + лого + кнопки
      mod.renderMenu(session.level);  // ← создаёт левое меню
      mod.initMenuControls();         // ← открытие/закрытие бургер-меню
    })
    .catch(err =>
      console.error('Ошибка загрузки topbar.module.js:', err)
    );

  // -------------------------------
  // 3) Загружаем FOOTER
  // -------------------------------
  import('/js/footer.js')
    .then(mod => {
      mod.renderFooter(session);
    })
    .catch(err =>
      console.error('Ошибка загрузки footer.js:', err)
    );

})();
