// guards.js — финальная версия под AUTH v3 (SV_AUTH.ready)

export function requireLevel(options = {}) {
  const {
    level: requiredLevel = 2,          // минимальный уровень
    redirectBase = 'login/login.html', // куда редиректить
  } = options;

  function doRedirect() {
    const next = encodeURIComponent(
      location.pathname + location.search + location.hash
    );
    location.replace(`${redirectBase}?next=${next}`);
  }

  function check(auth) {
    if (!auth) return doRedirect();

    const isAuth = !!auth.isAuthenticated;
    const level = Number(auth.level || 1);

    // если не авторизован или уровень ниже порога → на логин
    if (!isAuth || level < requiredLevel) {
      doRedirect();
    }
  }

  async function waitAndCheck() {
    // 1) Ждём пока загрузится AUTH bootstrap
    if (window.SV_AUTH?.ready) {
      try {
        const auth = await window.SV_AUTH.ready;
        check(auth);
        return;
      } catch {}
    }

    // 2) Если что-то пошло не так — пробуем сразу
    check(window.SV_AUTH);
  }

  waitAndCheck();
}
