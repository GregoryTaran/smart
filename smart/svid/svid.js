/* smart/svid/svid.js — GLOBAL build (Contract v1 compliant)
   - Единственный источник правды по visitor/user/level/jwt
   - Глобальный синглтон window.SVID (совместимо со "старым" кодом)
   - Идемпотентные события: svid:visitor, svid:user, svid:logout, svid:level, svid:error
   - Гарантия наличия уровня (≥1) и визитора (при сети)
*/
(() => {
  const API_BASE = '/api/svid';
  const SCHEMA_VERSION = 1;

  // === utils =================================================================
  function _state() {
    return {
      visitor_id: localStorage.getItem('svid.visitor_id') || null,
      visitor_level: +(localStorage.getItem('svid.visitor_level') || 0) || 0,
      user_id: localStorage.getItem('svid.user_id') || null,
      user_level: +(localStorage.getItem('svid.user_level') || 0) || 0,
      jwt: localStorage.getItem('svid.jwt') || null,
      level: +(localStorage.getItem('svid.level') || 0) || 0,
      schema: +(localStorage.getItem('svid.schema') || 0) || 0,
    };
  }
  function _set(k, v) {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, String(v));
  }
  function _dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) {}
  }
  async function http(path, { method = 'GET', body, headers = {} } = {}) {
    const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || text || `HTTP ${res.status}`;
      const err = new Error(msg);
      _dispatch('svid:error', { message: msg });
      throw err;
    }
    return data;
  }

  // === schema/init ===========================================================
  (function ensureSchema() {
    const st = _state();
    if (st.schema < SCHEMA_VERSION) {
      // future migrations would go here
      _set('svid.schema', SCHEMA_VERSION);
    }
    if (!st.level) _set('svid.level', 1); // уровень всегда есть
  })();

  // === core actions ==========================================================
  async function identify({ tz = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
    const st = _state();
    const body = { tz };
    if (st.visitor_id) body.visitor_id = st.visitor_id;
    const data = await http('/identify', { method: 'POST', body });

    // API can be { visitor_id, level } or { visitor: { visitor_id, level } }
    const vid = data?.visitor?.visitor_id ?? data?.visitor_id ?? null;
    const lvl = (data?.visitor?.level ?? data?.level ?? 1) || 1;

    if (vid) {
      _set('svid.visitor_id', vid);
      _set('svid.visitor_level', lvl);
      _set('svid.level', Math.max(1, lvl));
      _dispatch('svid:visitor', { visitor_id: vid, level: Math.max(1, lvl) });
      _dispatch('svid:level',   { level: Math.max(1, lvl) });
    }
    return data;
  }

  async function register({ display_name, email, password, visitor_id } = {}) {
    const body = {};
    if (display_name) body.display_name = String(display_name).trim();
    if (email) body.email = String(email).trim();
    if (password) body.password = password;
    const st = _state();
    body.visitor_id = visitor_id || st.visitor_id || undefined;

    const data = await http('/register', { method: 'POST', body });

    // Политика: пользователь считается залогиненным ТОЛЬКО при наличии jwt
    const hasJwt = !!(data && data.jwt);
    const userId = data?.user_id || data?.user?.id || null;
    const userLevel = (data?.user?.level ?? 2);

    if (hasJwt && userId) {
      _set('svid.user_id', userId);
      _set('svid.user_level', userLevel);
      _set('svid.jwt', data.jwt);
      _set('svid.level', userLevel);
      _dispatch('svid:user',  { user_id: userId, level: userLevel, jwt: data.jwt });
      _dispatch('svid:level', { level: userLevel });
    }

    // Обновим визитора, если сервер вернул
    const vid = data?.visitor?.visitor_id ?? data?.visitor_id ?? null;
    const lvl = (data?.visitor?.level ?? data?.level ?? 1) || 1;
    if (vid) {
      _set('svid.visitor_id', vid);
      _set('svid.visitor_level', lvl);
      // level не поднимаем здесь, т.к. без jwt это не "user"
      _dispatch('svid:visitor', { visitor_id: vid, level: Math.max(1, lvl) });
      // Принудительно синхронизируем текущий уровень (мог остаться 1)
      const eff = +(localStorage.getItem('svid.level') || 1);
      _dispatch('svid:level', { level: eff });
    }

    return data;
  }

  async function login({ email, password } = {}) {
    const body = {};
    if (email) body.email = String(email).trim();
    if (password) body.password = password;

    const data = await http('/login', { method: 'POST', body });
    const userId = data?.user_id || data?.user?.id || null;
    const userLevel = (data?.user?.level ?? 2);
    const jwt = data?.jwt || null;

    if (userId) {
      _set('svid.user_id', userId);
      _set('svid.user_level', userLevel);
      _set('svid.jwt', jwt);
      _set('svid.level', userLevel);
      _dispatch('svid:user',  { user_id: userId, level: userLevel, jwt });
      _dispatch('svid:level', { level: userLevel });
    }
    return data;
  }

  async function reset({ email, password } = {}) {
    const body = {};
    if (email) body.email = String(email).trim();
    if (password) body.password = password; // сервер может принять и без него (dev)
    return await http('/reset', { method: 'POST', body });
  }

  async function me() {
    const st = _state();
    const headers = {};
    if (st.jwt) headers['Authorization'] = `Bearer ${st.jwt}`;
    return await http('/me', { headers });
  }

  async function logout() {
    try { await http('/logout', { method: 'POST', body: {} }); } catch {}
    _set('svid.user_id', null);
    _set('svid.user_level', null);
    _set('svid.jwt', null);
    const st = _state();
    const lvl = st.visitor_level || 1;
    _set('svid.level', lvl);
    _dispatch('svid:logout', { level: lvl });
    _dispatch('svid:level',  { level: lvl });
    return { ok: true };
  }

  // === guarantee: visitor + level ===========================================
  async function ensureVisitorAndLevel() {
    const st0 = _state();
    // 1) если уже есть visitor+level -> просто разошлём события
    if (st0.visitor_id && st0.level) {
      _dispatch('svid:visitor', { visitor_id: st0.visitor_id, level: st0.level });
      _dispatch('svid:level',   { level: st0.level });
      return { visitor_id: st0.visitor_id, level: st0.level, source: 'storage' };
    }
    // 2) гарантия уровня
    if (!st0.level) _set('svid.level', 1);
    // 3) если нет визитора — создадим/подтвердим
    if (!st0.visitor_id) {
      try {
        const data = await identify({});
        const vid = data?.visitor?.visitor_id ?? data?.visitor_id ?? null;
        const lvl = (data?.visitor?.level ?? data?.level ?? 1) || 1;
        if (vid) return { visitor_id: vid, level: Math.max(1, lvl), source: 'network' };
      } catch (e) {
        _dispatch('svid:error', { message: String(e && e.message || e) });
      }
    }
    // 4) fallback: синхронизируем то, что есть
    const st = _state();
    _dispatch('svid:visitor', { visitor_id: st.visitor_id || null, level: st.level || 1 });
    _dispatch('svid:level',   { level: st.level || 1 });
    return { visitor_id: st.visitor_id || null, level: st.level || 1, source: 'fallback' };
  }

  // === public API ============================================================
  window.SVID = {
    identify, register, login, reset, me, logout,
    getState: _state,
    ensureVisitorAndLevel,
    ready: Promise.resolve().then(() => ensureVisitorAndLevel())
  };

  // авто-инициализация (не блокирующая)
  try { window.SVID.ready.catch(()=>{}); } catch(e){}
})();
