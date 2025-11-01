// smart/testserver/testserverclient.js
(function () {
  const out = document.getElementById('out');
  const btnPing = document.getElementById('btn-ping');
  const btnInfo = document.getElementById('btn-info');
  const btnTime = document.getElementById('btn-time');

  function write(v) {
    if (!out) return;
    if (typeof v === 'string') out.textContent = v;
    else out.textContent = JSON.stringify(v, null, 2);
  }

  async function call(path, opts = {}) {
    write('Ожидание ответа...');
    try {
      const res = await fetch(path, opts);
      if (!res.ok) {
        const text = await res.text().catch(()=>`HTTP ${res.status}`);
        throw new Error(text || `HTTP ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        write(json);
        return json;
      } else {
        const text = await res.text();
        write(text);
        return text;
      }
    } catch (err) {
      write({ ok: false, error: String(err) });
      return null;
    }
  }

  async function ping() {
    return call('/api/testserver/ping', { method: 'GET', cache: 'no-store' });
  }

  async function info() {
    return call('/api/testserver/info', { method: 'GET', cache: 'no-store' });
  }

  // Запрос времени сервера
  async function time() {
    return call('/api/testserver/time', { method: 'GET', cache: 'no-store' });
  }

  if (btnPing) btnPing.addEventListener('click', ping);
  if (btnInfo) btnInfo.addEventListener('click', info);
  if (btnTime) btnTime.addEventListener('click', time);

  // Небольшой авто-пинг при загрузке, чтобы показать связь
  (async function auto() {
    try { await ping(); } catch (e) { /* отображено в out */ }
  })();
})();
