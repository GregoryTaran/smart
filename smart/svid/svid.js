/* smart/svid/svid.js — SVID v2 (новая архитектура)
   - Работает с backend /api/svid/*
   - Не конфликтует с /api/auth/*
   - Управляет только visitor_id, level, user_id, jwt
   - Дружит с dictaphone и vision
*/

(() => {
  const API_BASE = "/api/svid";      // <-- НОВЫЙ ПРАВИЛЬНЫЙ ПУТЬ
  const SCHEMA_VERSION = 2;

  // ------------ utils ------------
  function _get() {
    return {
      visitor_id: localStorage.getItem('svid.visitor_id') || null,
      level: +(localStorage.getItem('svid.level') || 1),
      user_id: localStorage.getItem('svid.user_id') || null,
      jwt: localStorage.getItem('svid.jwt') || null,
      schema: +(localStorage.getItem('svid.schema') || 0)
    };
  }

  function _set(key, value) {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  }

  function _event(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); }
    catch {}
  }

  async function http(path, { method="GET", body, headers={} } = {}) {
    const opts = { method, headers: { "Content-Type": "application/json", ...headers } };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(API_BASE + path, opts);
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch {}

    if (!res.ok) {
      const msg = data?.detail || data?.error || txt || `HTTP ${res.status}`;
      _event("svid:error", { message: msg });
      throw new Error(msg);
    }
    return data;
  }

  // ------------ init schema ------------
  (function ensure() {
    const st = _get();
    if (st.schema < SCHEMA_VERSION) {
      _set("svid.schema", SCHEMA_VERSION);
      if (!st.level) _set("svid.level", 1);
    }
  })();

  // ------------ core actions ------------

  // идентификация визитора
  async function identify() {
    const st = _get();
    const body = {};
    if (st.visitor_id) body.visitor_id = st.visitor_id;

    const data = await http("/identify", { method: "POST", body });

    const vid = data?.visitor?.visitor_id ?? data?.visitor_id ?? null;
    const lvl = data?.visitor?.level ?? data?.level ?? 1;

    if (vid) {
      _set("svid.visitor_id", vid);
      _set("svid.level", lvl);
      _event("svid:visitor", { visitor_id: vid, level: lvl });
      _event("svid:level",   { level: lvl });
    }

    return data;
  }

  // регистрация пользователя
  async function register({ email, password, display_name } = {}) {
    const st = _get();

    const body = {
      email: email?.trim(),
      password,
      display_name,
      visitor_id: st.visitor_id || undefined
    };

    const data = await http("/register", { method: "POST", body });

    // регистрация НЕ логинит
    const vid = data?.visitor?.visitor_id ?? null;
    const lvl = data?.visitor?.level ?? 1;

    if (vid) {
      _set("svid.visitor_id", vid);
      _set("svid.level", lvl);
      _event("svid:visitor", { visitor_id: vid, level: lvl });
      _event("svid:level",   { level: lvl });
    }

    return data;
  }

  // логин пользователя
  async function login({ email, password } = {}) {
    const data = await http("/login", { method: "POST", body: { email, password } });

    const userId = data?.user?.id || data?.user_id || null;
    const userLevel = data?.user?.level ?? 2;
    const jwt = data?.jwt || null;

    if (userId) {
      _set("svid.user_id", userId);
      _set("svid.jwt", jwt);
      _set("svid.level", userLevel);

      _event("svid:user",  { user_id: userId, level: userLevel, jwt });
      _event("svid:level", { level: userLevel });
    }
    return data;
  }

  async function logout() {
    try { await http("/logout", { method:"POST" }); } catch {}

    const vid = localStorage.getItem("svid.visitor_id");
    const lvl = +(localStorage.getItem("svid.visitor_level") || 1);

    _set("svid.user_id", null);
    _set("svid.jwt", null);
    _set("svid.level", lvl);

    _event("svid:logout", { level: lvl });
    _event("svid:level", { level: lvl });

    return { ok:true };
  }

  async function me() {
    const st = _get();
    const headers = {};
    if (st.jwt) headers["Authorization"] = "Bearer " + st.jwt;
    return await http("/me", { headers });
  }

  // ------------ гарантированная инициализация ------------
  async function ensureVisitor() {
    const st = _get();

    if (st.visitor_id) {
      _event("svid:visitor", { visitor_id: st.visitor_id, level: st.level });
      _event("svid:level",   { level: st.level });
      return { visitor_id: st.visitor_id, level: st.level, source:"cache" };
    }

    try {
      const data = await identify();
      const vid = data?.visitor?.visitor_id ?? null;
      const lvl = data?.visitor?.level ?? 1;
      return { visitor_id: vid, level: lvl, source:"network" };
    }
    catch (e) {
      return { visitor_id: null, level:1, source:"error" };
    }
  }

  // ------------ export API ------------
  window.SVID = {
    getState: _get,
    identify,
    register,
    login,
    logout,
    me,
    ensureVisitor,
    ready: Promise.resolve().then(ensureVisitor)
  };

  // автозагрузка
  window.SVID.ready.catch(()=>{});
})();
