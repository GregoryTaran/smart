/* smart/svid/svid.js — VISITOR ONLY (чистая v2)
   — Работает только с visitor_id и уровнем гостя
   — НИКАКОЙ авторизации, паролей, JWT, user_id
   — Не конфликтует с AUTH v3
*/

(() => {
  const API_BASE = "/api/svid";

  function _getState() {
    return {
      visitor_id: localStorage.getItem("svid.visitor_id") || null,
      level: Number(localStorage.getItem("svid.level") || 1)
    };
  }

  function _set(key, val) {
    if (val === null || val === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(val));
    }
  }

  function _emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); }
    catch (e) {}
  }

  async function _http(path, { method = "GET", body } = {}) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const r = await fetch(API_BASE + path, opts);
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    if (!r.ok) {
      console.warn("SVID error:", data?.detail || text || r.status);
      throw new Error(data?.detail || text || "SVID error");
    }
    return data;
  }

  // ---------------------------------------------------------------
  // IDENTIFY — главный и единственный “боевой” метод
  // ---------------------------------------------------------------
  async function identify() {
    const st = _getState();
    const payload = {};

    if (st.visitor_id) payload.visitor_id = st.visitor_id;

    const data = await _http("/identify", { method: "POST", body: payload });

    const vid = data?.visitor_id || null;
    const lvl = Number(data?.level || 1);

    if (vid) {
      _set("svid.visitor_id", vid);
      _set("svid.level", lvl);

      _emit("svid:visitor", { visitor_id: vid });
      _emit("svid:level", { level: lvl });
    }

    return { visitor_id: vid, level: lvl };
  }

  // ---------------------------------------------------------------
  // ensureVisitor — вызываем один раз при загрузке приложения
  // ---------------------------------------------------------------
  async function ensureVisitor() {
    const st = _getState();

    if (st.visitor_id) {
      _emit("svid:visitor", { visitor_id: st.visitor_id });
      _emit("svid:level", { level: st.level });
      return { ...st, source: "cache" };
    }

    try {
      const data = await identify();
      return { ...data, source: "network" };
    }
    catch {
      return { visitor_id: null, level: 1, source: "error" };
    }
  }

  // ---------------------------------------------------------------
  // экспорт
  // ---------------------------------------------------------------
  window.SVID = {
    getState: _getState,
    identify,
    ensureVisitor,
    ready: Promise.resolve().then(ensureVisitor)
  };

})();
