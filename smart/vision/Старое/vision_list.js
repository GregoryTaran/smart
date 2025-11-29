// ========================================
//  SMART VISION — ГЛОБАЛЬНОЕ ЯДРО АВТОРИЗАЦИИ (ФИНАЛ)
// ========================================

(() => {
  // 1) Создаём глобальный объект один раз
  const SV_AUTH = {
    isAuthenticated: false,
    authenticated: false,  // алиас
    user: null,
    userId: null,
    user_id: null,         // алиас
    email: null,
    name: null,
    level: 1,
    loading: true,
    ready: null,
    _resolve: null
  };

  SV_AUTH.ready = new Promise((resolve) => {
    SV_AUTH._resolve = resolve;
  });

  window.SV_AUTH = SV_AUTH;

  // 2) Грузим статус с бэка
  async function loadAuth() {
    try {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include"
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }

      if (res.ok && data && data.loggedIn) {
        // ожидаемый формат: { loggedIn, level, user: { id, email, name } }
        const u = data.user || {};
        SV_AUTH.isAuthenticated = true;
        SV_AUTH.authenticated   = true;
        SV_AUTH.user            = u;
        SV_AUTH.userId          = u.id || null;
        SV_AUTH.user_id         = u.id || null;
        SV_AUTH.email           = u.email || null;
        SV_AUTH.name            = u.name || null;
        SV_AUTH.level           = data.level ?? 1;
      } else {
        // гость
        SV_AUTH.isAuthenticated = false;
        SV_AUTH.authenticated   = false;
        SV_AUTH.user            = null;
        SV_AUTH.userId          = null;
        SV_AUTH.user_id         = null;
        SV_AUTH.email           = null;
        SV_AUTH.name            = null;
        SV_AUTH.level           = 1;
      }
    } catch (err) {
      console.warn("AUTH /me error:", err);
      SV_AUTH.isAuthenticated = false;
      SV_AUTH.authenticated   = false;
      SV_AUTH.user            = null;
      SV_AUTH.userId          = null;
      SV_AUTH.user_id         = null;
      SV_AUTH.email           = null;
      SV_AUTH.name            = null;
      SV_AUTH.level           = 1;
    }

    SV_AUTH.loading = false;
    if (typeof SV_AUTH._resolve === "function") {
      SV_AUTH._resolve(SV_AUTH);
      SV_AUTH._resolve = null;
    }
  }

  // 3) Инициализация топбара/меню после загрузки auth
  async function initLayout() {
    try {
      const auth = await SV_AUTH.ready;

      const mod = await import("/js/topbar.module.js");

      if (typeof mod.renderTopbar === "function") {
        mod.renderTopbar(auth);
      }
      if (typeof mod.renderMenu === "function") {
        mod.renderMenu(auth.level);
      }
      if (typeof mod.initMenuControls === "function") {
        mod.initMenuControls();
      }
      if (typeof mod.syncAuthLink === "function") {
        mod.syncAuthLink(auth);
      }
    } catch (e) {
      console.warn("Topbar init error:", e);
    }

    // футер необязателен, но можно так:
    try {
      const footer = await import("/js/footer.js");
      if (typeof footer.renderFooter === "function") {
        footer.renderFooter(SV_AUTH);
      }
    } catch (e) {
      // если футера нет — просто молчим
    }
  }

  // 4) Глобальный logout
  window.SV_LOGOUT = async function () {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    } catch (e) {}
    window.location.href = "/index.html";
  };

  // Старт
  loadAuth();
  initLayout();
})();
