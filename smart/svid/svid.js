// /smart/svid/svid.js
// SVID — фронтовое ядро: identify / register / login / reset / logout
// Хранит visitor_id, user_id, уровни и (опц.) jwt в localStorage.
// Интеграция с UI: window события и единый уровень в localStorage.

;(function () {
  const API_BASE = `${location.origin}/api/svid`;

  // ключи стораджа
  const LS = {
    VISITOR_ID:   'svid.visitor_id',
    VISITOR_LVL:  'svid.visitor_level', // 1
    USER_ID:      'svid.user_id',
    USER_LVL:     'svid.user_level',    // 2
    JWT:          'svid.jwt',
  };
  const LVL_KEY = 'svid.level'; // единый текущий уровень для всего UI

  // утилиты стораджа
  const storage = {
    get(k)   { return localStorage.getItem(k); },
    set(k,v) { localStorage.setItem(k, v); },
    del(k)   { localStorage.removeItem(k); },
  };

  // безопасный fetch
  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  // события наружу — через window (ловит topbar)
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function setLevel(n) {
    const lvl = Number.isFinite(+n) ? +n : 1;
    localStorage.setItem(LVL_KEY, String(lvl));
    window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: lvl } }));
  }

  function setVisitor({ visitor_id, level }) {
    if (visitor_id) storage.set(LS.VISITOR_ID, visitor_id);
    if (Number.isFinite(+level)) storage.set(LS.VISITOR_LVL, String(+level));
    setLevel(Number.isFinite(+level) ? +level : 1);
    emit('svid:visitor', { visitor_id, level: Number.isFinite(+level) ? +level : 1 });
  }

  function setUser({ user_id, level, jwt }) {
    if (user_id) storage.set(LS.USER_ID, user_id);
    if (Number.isFinite(+level)) storage.set(LS.USER_LVL, String(+level));
    if (jwt)     storage.set(LS.JWT, jwt);
    setLevel(Number.isFinite(+level) ? +level : 2);
    emit('svid:user', { user_id, level: Number.isFinite(+level) ? +level : 2, jwt: jwt || null });
  }

  function clearUserKeepVisitor() {
    storage.del(LS.USER_ID);
    storage.del(LS.USER_LVL);
    storage.del(LS.JWT);
    const vLvl = parseInt(storage.get(LS.VISITOR_LVL) || '1', 10);
    setLevel(Number.isFinite(vLvl) ? vLvl : 1);
    emit('svid:logout', {});
  }

  // ---------- Публичное API ----------
  const SVID = {
    ready: null, // промис с { level }

    // Инициализация на любой странице
    async init() {
      // если нет визитора — идентифицируем
      if (!storage.get(LS.VISITOR_ID)) {
        try {
          await this.identify();
        } catch (e) {
          console.warn('[SVID] identify failed', e);
          setLevel(1);
        }
      } else {
        emit('svid:visitor', {
          visitor_id: storage.get(LS.VISITOR_ID),
          level:      parseInt(storage.get(LS.VISITOR_LVL) || '1', 10),
        });
        // синк уровня из локалки
        setLevel(parseInt(storage.get(LS.VISITOR_LVL) || '1', 10));
      }

      // если есть юзер — сообщим UI и повысим уровень
      const user_id = storage.get(LS.USER_ID);
      if (user_id) {
        emit('svid:user', {
          user_id,
          level: parseInt(storage.get(LS.USER_LVL) || '2', 10),
          jwt:   storage.get(LS.JWT) || null,
        });
        setLevel(parseInt(storage.get(LS.USER_LVL) || '2', 10));
      }

      if (!this.ready) {
        this.ready = Promise.resolve({ level: parseInt(localStorage.getItem(LVL_KEY) || '1', 10) });
      }
    },

    // Шаг 1 — Идентификация визитора
    async identify() {
      const payload = {
        fingerprint: navigator.userAgent,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        visitor_id: storage.get(LS.VISITOR_ID) || null,
      };
      const data = await api('/identify', { method: 'POST', body: payload });
      setVisitor(data); // { visitor_id, level }
      return data;
    },

    // Шаг 2а — Регистрация
    async register({ name, email, password }) {
      const payload = {
        name, email, password,
        visitor_id: storage.get(LS.VISITOR_ID) || null,
      };
      const data = await api('/register', { method: 'POST', body: payload });
      if (data?.visitor) setVisitor(data.visitor);
      setUser(data); // ожидаем { user_id, level (2), jwt? }
      return data;
    },

    // Шаг 2б — Вход
    async login({ email, password }) {
      const payload = { email, password, visitor_id: storage.get(LS.VISITOR_ID) || null };
      const data = await api('/login', { method: 'POST', body: payload });
      if (data?.visitor) setVisitor(data.visitor);
      setUser(data); // ожидаем { user_id, level (2), jwt? }
      return data;
    },

    // Шаг 2в — Сброс пароля
    async resetPassword({ email }) {
      const data = await api('/reset', { method: 'POST', body: { email } });
      emit('svid:password_reset', data);
      return data;
    },

    // Шаг 4 — Выход
    async logout() {
      try {
        await api('/logout', { method: 'POST', body: { user_id: storage.get(LS.USER_ID) } });
      } catch (e) {
        console.warn('[SVID] logout non-200', e);
      }
      clearUserKeepVisitor(); // visitor остаётся, user очищаем
      return { ok: true };
    },

    // Вспомогательное
    getState() {
      return {
        visitor_id: storage.get(LS.VISITOR_ID),
        visitor_level: storage.get(LS.VISITOR_LVL),
        user_id: storage.get(LS.USER_ID),
        user_level: storage.get(LS.USER_LVL),
        jwt: storage.get(LS.JWT),
      };
    },

    // управление уровнем вручную (для админки/тестов)
    setLevel(n) { setLevel(n); },

    // Жёстко очистить всё (включая визитора)
    nukeAll() {
      Object.values(LS).forEach((k) => storage.del(k));
      emit('svid:nuked', {});
      setLevel(1);
    }
  };

  // Экспорт в глобал
  window.SVID = SVID;

  // Автоинициализация
  document.addEventListener('DOMContentLoaded', () => {
    SVID.init().catch((e) => {
      console.warn('[SVID] init failed:', e.message);
      setLevel(1);
    });
  });
})();
