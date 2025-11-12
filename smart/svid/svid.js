/* smart/svid/svid.js — обновлённый клиент
   - детальные ошибки (detail|error|message|raw)
   - не шлёт пустые строки
   - alias resetPassword → reset
*/
(() => {
  const API_BASE = '/api/svid';

  function _state() {
    return {
      visitor_id: localStorage.getItem('svid.visitor_id') || null,
      visitor_level: +(localStorage.getItem('svid.visitor_level') || 0) || 0,
      user_id: localStorage.getItem('svid.user_id') || null,
      user_level: +(localStorage.getItem('svid.user_level') || 0) || 0,
      jwt: localStorage.getItem('svid.jwt') || null,
      level: +(localStorage.getItem('svid.level') || 0) || 0,
    };
  }
  function _set(k, v) {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, String(v));
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
      throw new Error(msg);
    }
    return data;
  }

  function buildPayload(formEl, fields) {
    const out = {};
    for (const f of fields) {
      let v = formEl.querySelector(`[name="${f}"]`)?.value;
      if (typeof v === 'string') v = v.trim();
      if (v === '' || v === undefined) continue;     // не шлём пустые
      out[f] = v;
    }
    return out;
  }

  async function identify({ tz = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
    const st = _state();
    const body = { tz };
    if (st.visitor_id) body.visitor_id = st.visitor_id;
    const data = await http('/identify', { method: 'POST', body });
    if (data?.visitor_id) {
      _set('svid.visitor_id', data.visitor_id);
      _set('svid.visitor_level', data.level ?? 1);
      _set('svid.level', data.level ?? 1);
      window.dispatchEvent(new CustomEvent('svid:visitor', { detail: { visitor_id: data.visitor_id, level: data.level ?? 1 } }));
    }
    return data;
  }

  async function register({ display_name, email, password, visitor_id } = {}) {
    const body = {};
    if (display_name) body.display_name = display_name.trim();
    if (email) body.email = email.trim();
    if (password) body.password = password;
    const st = _state();
    body.visitor_id = visitor_id || st.visitor_id || undefined;

    const data = await http('/register', { method: 'POST', body });
    if (data?.jwt) {
      _set('svid.user_id', data.user_id);
      _set('svid.user_level', data.user?.level ?? 2);
      _set('svid.jwt', data.jwt || null);
      _set('svid.level', data.user?.level ?? 2);
      window.dispatchEvent(new CustomEvent('svid:user', { detail: { user_id: data.user_id, level: data.user?.level ?? 2, jwt: data.jwt || null } }));
    }
    if (data?.visitor?.visitor_id) {
      _set('svid.visitor_id', data.visitor.visitor_id);
      _set('svid.visitor_level', data.visitor.level ?? 1);
    
    try { window.dispatchEvent(new CustomEvent('svid:visitor', { detail: { visitor_id: data.visitor.visitor_id, level: (data.visitor.level ?? 1) } })); } catch (e) {}
  }
    return data;
  }

  async function login({ email, password } = {}) {
    const body = {};
    if (email) body.email = email.trim();
    if (password) body.password = password;

    const data = await http('/login', { method: 'POST', body });
    if (data?.jwt) {
      _set('svid.user_id', data.user_id);
      _set('svid.user_level', data.user?.level ?? 2);
      _set('svid.jwt', data.jwt || null);
      _set('svid.level', data.user?.level ?? 2);
      window.dispatchEvent(new CustomEvent('svid:user', { detail: { user_id: data.user_id, level: data.user?.level ?? 2, jwt: data.jwt || null } }));
    }
    return data;
  }

  async function reset({ email, password } = {}) {
    const body = {};
    if (email) body.email = email.trim();
    if (password) body.password = password; // сервер примет и без него (dev)
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
    window.dispatchEvent(new CustomEvent('svid:logout', { detail: { level: lvl } }));
    return { ok: true };
  }

  // экспорт
  window.SVID = {
    identify, register, login, reset, me, logout,
    getState: _state, buildPayload,
  };
  // алиас для старого кода
  window.SVID.resetPassword = window.SVID.reset;
})();
