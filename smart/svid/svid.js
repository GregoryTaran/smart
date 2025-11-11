// /smart/svid/svid.js
// SVID — фронтовое ядро: identify / register / login / reset / logout
// Хранит visitor_id, user_id, уровни и (опц.) jwt в localStorage.
// Никаких фреймворков, только fetch + события для интеграции c UI.
// Автор: Greg & Bro, SMART VISION 🤝

;(function () {
  const API_BASE = `${location.origin}/api/svid`;

  // ключи стораджа
  const LS = {
    VISITOR_ID:   'svid.visitor_id',
    VISITOR_LVL:  'svid.visitor_level',
    USER_ID:      'svid.user_id',
    USER_LVL:     'svid.user_level',
    JWT:          'svid.jwt',
  };

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

  // эмит событий для внешнего UI
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function setVisitor({ visitor_id, level }) {
    if (visitor_id) storage.set(LS.VISITOR_ID, visitor_id);
    if (level)      storage.set(LS.VISITOR_LVL, level);
    emit('svid:visitor', { visitor_id, level });
  }

  function setUser({ user_id, level, jwt }) {
    if (user_id) storage.set(LS.USER_ID, user_id);
    if (level)   storage.set(LS.USER_LVL, level);
    if (jwt)     storage.set(LS.JWT, jwt);
    emit('svid:user', { user_id, level, jwt });
  }

  function clearUserKeepVisitor() {
    storage.del(LS.USER_ID);
    storage.del(LS.USER_LVL);
    storage.del(LS.JWT);
    emit('svid:logout', {});
  }

  // ---------- Публичное API ----------
  const SVID = {
    // Инициализация на любой странице
    async init() {
      // 1) есть визитор? — ок; нет — идентифицируем
      if (!storage.get(LS.VISITOR_ID)) {
        await this.identify();
      } else {
        emit('svid:visitor', {
          visitor_id: storage.get(LS.VISITOR_ID),
          level:      storage.get(LS.VISITOR_LVL) || 'guest',
        });
      }
      // 2) если есть юзер — сообщим UI об этом
      const user_id = storage.get(LS.USER_ID);
      if (user_id) {
        emit('svid:user', {
          user_id,
          level: storage.get(LS.USER_LVL) || 'user',
          jwt:   storage.get(LS.JWT) || null,
        });
      }
    },

    // Шаг 1 — Идентификация визитора
    async identify() {
      const payload = {
        fingerprint: navigator.userAgent,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        visitor_id: storage.get(LS.VISITOR_ID) || null, // если уже есть, бэк может обновить/вернуть
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
      // ожидаем: { user_id, level, jwt? , visitor: { visitor_id, level }? }
      if (data?.visitor) setVisitor(data.visitor);
      setUser(data);
      return data;
    },

    // Шаг 2б — Вход
    async login({ email, password }) {
      const payload = { email, password, visitor_id: storage.get(LS.VISITOR_ID) || null };
      const data = await api('/login', { method: 'POST', body: payload });
      if (data?.visitor) setVisitor(data.visitor);
      setUser(data);
      return data;
    },

    // Шаг 2в — Сброс пароля (dev: отдаёт пароль; prod: отправляет на почту)
    async resetPassword({ email }) {
      const data = await api('/reset', { method: 'POST', body: { email } });
      // { new_password? } — в деве есть
      emit('svid:password_reset', data);
      return data;
    },

    // Шаг 4 — Выход
    async logout() {
      await api('/logout', { method: 'POST', body: { user_id: storage.get(LS.USER_ID) } });
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

    // Жёстко очистить всё (включая визитора)
    nukeAll() {
      Object.values(LS).forEach((k) => storage.del(k));
      emit('svid:nuked', {});
    }
  };

  // Экспорт в глобал
  window.SVID = SVID;

  // Автоинициализация (можно отключить, если не нужно)
  document.addEventListener('DOMContentLoaded', () => {
    SVID.init().catch((e) => {
      console.warn('[SVID] init failed:', e.message);
    });
  });
})();
