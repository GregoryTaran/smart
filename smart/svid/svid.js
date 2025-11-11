/* svid/svid.js — фронтовой клиент идентификации/аутентификации
   Бэкенд: модуль svid, маршруты /api/svid/*
   Эндпоинты: POST /identify | /register | /login | /reset | /logout, GET /me

   Фронт-стояние (только для UI):
     svid.visitor_id, svid.visitor_level
     svid.user_id,    svid.user_level
     svid.jwt
     svid.level       // единый текущий уровень для меню/страниц
*/

;(function () {
  const API_BASE = '/api/svid';

  const LS = {
    VISITOR_ID:  'svid.visitor_id',
    VISITOR_LVL: 'svid.visitor_level',
    USER_ID:     'svid.user_id',
    USER_LVL:    'svid.user_level',
    JWT:         'svid.jwt',
  };
  const LVL_KEY = 'svid.level';

  // ---------------- utils ----------------
  const storage = {
    get(k)   { return localStorage.getItem(k); },
    set(k,v) { localStorage.setItem(k, v); },
    del(k)   { localStorage.removeItem(k); },
  };
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
  function setLevel(n) {
    const lvl = Number.isFinite(+n) ? +n : 1;
    localStorage.setItem(LVL_KEY, String(lvl));
    emit('svid:level', { level: lvl });
  }
  function ensureUILvlFromState() {
    try {
      const s = SVID?.getState?.() || {};
      const lvl = Number(s.user_level) || Number(s.visitor_level) || 1;
      if (String(localStorage.getItem(LVL_KEY)) !== String(lvl)) {
        localStorage.setItem(LVL_KEY, String(lvl));
        emit('svid:level', { level: lvl });
      }
    } catch { /* no-op */ }
  }

  async function http(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const jwt = storage.get(LS.JWT);
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });

    if (res.status === 204) return { ok: true };
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
    return data;
  }

  // ---------------- state setters ----------------
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

  // ---------------- public API ----------------
  const SVID = {
    ready: null,

    async init() {
      // 1) ensure visitor
      if (!storage.get(LS.VISITOR_ID)) {
        try {
          const r = await this.identify();
          if (!r?.visitor_id) setLevel(1);
        } catch {
          setLevel(1);
        }
      } else {
        const v = {
          visitor_id: storage.get(LS.VISITOR_ID),
          level: parseInt(storage.get(LS.VISITOR_LVL) || '1', 10),
        };
        setLevel(Number.isFinite(+v.level) ? +v.level : 1);
        emit('svid:visitor', v);
      }

      // 2) promote user if present
      const user_id = storage.get(LS.USER_ID);
      if (user_id) {
        const u = {
          user_id,
          level: parseInt(storage.get(LS.USER_LVL) || '2', 10),
          jwt: storage.get(LS.JWT) || null,
        };
        setLevel(Number.isFinite(+u.level) ? +u.level : 2);
        emit('svid:user', u);
      }

      if (!this.ready) {
        this.ready = Promise.resolve({ level: parseInt(localStorage.getItem(LVL_KEY) || '1', 10) });
      }

      // синхронизируем UI-уровень на старте (и для bfcache)
      ensureUILvlFromState();
    },

    // --- endpoints ---
    async identify() {
      const payload = {
        fingerprint: navigator.userAgent,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        visitor_id: storage.get(LS.VISITOR_ID) || null,
      };
      const res = await http('/identify', { method: 'POST', body: payload });
      setVisitor({ visitor_id: res.visitor_id, level: res.level ?? 1 });
      return res;
    },

    async register({ name, email, password }) {
      const payload = { name, email, password, visitor_id: storage.get(LS.VISITOR_ID) || null };
      const res = await http('/register', { method: 'POST', body: payload });
      if (res?.visitor) setVisitor(res.visitor);
      setUser({ user_id: res.user_id, level: res.level ?? 2, jwt: res.jwt });
      return res;
    },

    async login({ email, password }) {
      const payload = { email, password, visitor_id: storage.get(LS.VISITOR_ID) || null };
      const res = await http('/login', { method: 'POST', body: payload });
      if (res?.visitor) setVisitor(res.visitor);
      setUser({ user_id: res.user_id, level: res.level ?? 2, jwt: res.jwt });

      // жёсткий редирект только если мы на странице логина
      try {
        if (/\/login\/?/.test(location.pathname)) {
          location.href = `${location.origin}/index.html`;
        }
      } catch { /* no-op */ }

      return res;
    },

    async reset({ email, password }) {
      const res = await http('/reset', { method: 'POST', body: { email, password } });
      emit('svid:password_reset', res);
      return res;
    },

    async logout() {
      try {
        await http('/logout', { method: 'POST', body: { user_id: storage.get(LS.USER_ID) } });
      } catch { /* dev: сервер может вернуть не-200, это ок */}
      clearUserKeepVisitor();
      return { ok: true };
    },

    // удобство для index.js
    async me() {
      return http('/me', { method: 'GET' }); // Authorization подтянется из localStorage
    },

    // helpers
    setLevel(n) { setLevel(n); },
    getLevel()  { return parseInt(localStorage.getItem(LVL_KEY) || '1', 10); },
    getState() {
      return {
        visitor_id: storage.get(LS.VISITOR_ID),
        visitor_level: storage.get(LS.VISITOR_LVL),
        user_id: storage.get(LS.USER_ID),
        user_level: storage.get(LS.USER_LVL),
        jwt: storage.get(LS.JWT),
      };
    },
    nukeAll() {
      Object.values(LS).forEach(k => storage.del(k));
      emit('svid:nuked', {});
      setLevel(1);
    },
  };

  // ---------------- boot ----------------
  window.SVID = SVID;

  // Восстановление после bfcache (назад/вперёд)
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) ensureUILvlFromState();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SVID.init());
  } else {
    SVID.init();
  }
})();
