// js/guards.js

export function requireLevel(options = {}) {
  const {
    level: requiredLevel = 2,          // минимальный уровень доступа
    redirectBase = 'login/login.html', // куда гнать неавторизованных
  } = options;

  function doRedirect() {
    const next = encodeURIComponent(
      location.pathname + location.search + location.hash
    );
    location.replace(`${redirectBase}?next=${next}`);
  }

  function checkAuth(rawAuth) {
    const auth = rawAuth || window.SV_AUTH || {};
    const isAuthenticated = !!auth.isAuthenticated;
    const level = Number(auth.level || 1);

    if (!isAuthenticated || level < requiredLevel) {
      doRedirect();
    }
  }

  // 1) Если авторизация уже загружена к этому моменту
  if (window.SV_AUTH && window.SV_AUTH.loaded) {
    checkAuth(window.SV_AUTH);
  }

  // 2) Плюс слушаем событие на будущее
  document.addEventListener('sv:auth-ready', (event) => {
    checkAuth(event.detail);
  });
}
