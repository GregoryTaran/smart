// smartid.init.js — единый бутстрап авторизации + топбар/меню

const AUTH_CACHE_KEY = 'sv.auth.cache.v1';

// ---------------------------------------------------------
// 1. Глобальный объект авторизации SV_AUTH
//    (по мотивам inline-скрипта из vision.html)
// ---------------------------------------------------------
(function initGlobalAuthObject() {
  if (window.SV_AUTH && window.SV_AUTH.ready) {
    // уже инициализирован (например, как в vision.html)
    return;
  }

  const base = {
    isAuthenticated: false,
    userId: null,
    email: null,
    displayName: null,
    level: 1,
    levelCode: 'guest',
    loaded: false,
    _resolve: null,
    ready: null
  };

  base.ready = new Promise((resolve) => {
    base._resolve = resolve;
  });

  window.SV_AUTH = base;
})();

// удобный алиас
const SV_AUTH = window.SV_AUTH;

// ---------------------------------------------------------
// 2. Бутстрап авторизации: /api/auth/me + кэш
// ---------------------------------------------------------
async function bootstrapAuth() {
  try {
    // 2.1. Поднимаем кэш, если есть
    const cached = localStorage.getItem(AUTH_CACHE_KEY);
    if (cached) {
      try {
        Object.assign(SV_AUTH, JSON.parse(cached));
      } catch (e) {
        console.warn('SV_AUTH cache parse error', e);
      }
    }

    // 2.2. Живой запрос к серверу
    const resp = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include'
    });

    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }

    if (resp.ok && data) {
      // Логика такая же, как в vision.html
      if (data.loggedIn) {
        const u = data.user_merged || {};
        SV_AUTH.isAuthenticated = true;
        SV_AUTH.userId = u.id || null;
        SV_AUTH.email = u.email || null;
        SV_AUTH.displayName = u.name || null;
        SV_AUTH.level = data.level ?? 2;
        SV_AUTH.levelCode = data.level_code || 'user';
      } else {
        SV_AUTH.isAuthenticated = false;
        SV_AUTH.userId = null;
        SV_AUTH.level = 1;
        SV_AUTH.levelCode = 'guest';
      }
    } else {
      // 401 / 403 / 500 → гость
      SV_AUTH.isAuthenticated = false;
      SV_AUTH.userId = null;
      SV_AUTH.level = 1;
      SV_AUTH.levelCode = 'guest';
    }

    // 2.3. Обновляем кэш
    try {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        isAuthenticated: SV_AUTH.isAuthenticated,
        userId: SV_AUTH.userId,
        email: SV_AUTH.email,
        displayName: SV_AUTH.displayName,
        level: SV_AUTH.level,
        levelCode: SV_AUTH.levelCode
      }));
    } catch (e) {
      console.warn('SV_AUTH cache save error', e);
    }
  } catch (e) {
    console.warn('SV_AUTH bootstrap error', e);
  } finally {
    SV_AUTH.loaded = true;
    if (typeof SV_AUTH._resolve === 'function') {
      SV_AUTH._resolve(SV_AUTH);
    }
  }
}

// ---------------------------------------------------------
// 3. Бутстрап layout: topbar / меню / управление
// ---------------------------------------------------------
async function bootstrapLayout() {
  try {
    const session = await SV_AUTH.ready;

    // Путь по твоим словам: модуль лежит в /js/topbar.module.js
    const mod = await import('/js/topbar.module.js');

    // Вариант 1: если есть initPage (как в vision.html)
    if (typeof mod.initPage === 'function') {
      mod.initPage({
        session,
        fragments: [['menu.html', '#sidebar']],
        cacheBust: false,
        topbar: {
          state: {
            logoHref: 'index.html',
            logoSrc: 'assets/logo400.jpg'
          }
        }
      });
      return;
    }

    // Вариант 2: если используется новый API (renderTopbar / renderMenu / initMenuControls)
    if (typeof mod.renderTopbar === 'function') {
      mod.renderTopbar(session);
    }
    if (typeof mod.renderMenu === 'function') {
      // По старой логике: level 1/2
      mod.renderMenu(session.level ?? 1);
    }
    if (typeof mod.initMenuControls === 'function') {
      mod.initMenuControls();
    }
  } catch (e) {
    console.warn('SV layout init error', e);
  }
}

// ---------------------------------------------------------
// 4. Запуск
// ---------------------------------------------------------
bootstrapAuth();
bootstrapLayout();

// Для отладки — чтобы в консоли было видно состояние
if (!window.SMART_SESSION) {
  window.SMART_SESSION = SV_AUTH;
}
