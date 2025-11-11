/* svid/svid.js — фронтовой клиент идентификации/аутентификации
   БЭКЕНД: модуль svid на сервере (папка server/svid), маршруты /api/svid/*
   Эндпоинты:
     POST /api/svid/identify
     POST /api/svid/register
     POST /api/svid/login
     POST /api/svid/reset
     POST /api/svid/logout

   Хранение на фронте (localStorage, только для UI):
     svid.visitor_id, svid.visitor_level
     svid.user_id,    svid.user_level
     svid.jwt         (dev-режим)
     svid.level       (единый текущий уровень для всего UI)
*/

;(function () {
  const API_BASE = '/api/svid'; // относительный путь

  const LS = {
    VISITOR_ID:  'svid.visitor_id',
    VISITOR_LVL: 'svid.visitor_level', // 1
    USER_ID:     'svid.user_id',
    USER_LVL:    'svid.user_level',    // 2
    JWT:         'svid.jwt',
  };
  const LVL_KEY = 'svid.level';

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
    window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: lvl } }));
  }

  // --- NEW: страховка уровня UI из текущего стораджа SVID (в т.ч. после bfcache)
  function ensureUILvlFromState() {
    try {
      const s = SVID?.getState?.() || {};
      const lvl = Number(s.user_level) || Number(s.visitor_level) || 1;
      if (String(localStorage.getItem(LVL_KEY)) !== String(lvl)) {
        localStorage.setItem(LVL_KEY, String(lvl));
        window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: lvl } }));
        console.log('[SVID] ensureUILvlFromState ->', lvl);
      }
    } catch (e) {
      console.warn('[SVID] ensureUILvlFromState error', e);
    }
  }

  async function http(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const jwt = token || storage.get(LS.JWT);
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
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
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

  const SVID = {
    ready: null, // Promise<{ level:number }>,

    async init() {
      // 1) ensure visitor
      if (!storage.get(LS.VISITOR_ID)) {
        try {
          const r = await this.identify();
          if (!r?.visitor_id) setLevel(1);
        } catch (e) {
          console.warn('[SVID] identify failed', e);
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

      // 2) если уже есть пользователь — активируем UI
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

      // --- NEW: сразу синхронизировать UI-уровень из состояния
      ensureUILvlFromState();
    },

    // -------- API методы к /api/svid/* --------

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
      } catch (e) {
        console.warn('[SVID] logout non-2xx', e);
      }
      clearUserKeepVisitor();
      return { ok: true };
    },

    // вспомогательные
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

  window.SVID = SVID;

  // --- NEW: после возврата страницы из bfcache переустановить уровень
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      ensureUILvlFromState();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SVID.init());
  } else {
    SVID.init();
  }
})();
