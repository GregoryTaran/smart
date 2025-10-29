// smart/testserver/testserverclient.js
// Минимальный клиент для testserver
// Работает с API по /api/testserver/*
// Автопинг при загрузке, кнопки Ping и Info

(function () {
  const out = document.getElementById('out');
  const btnPing = document.getElementById('btn-ping');
  const btnInfo = document.getElementById('btn-info');

  function write(v) {
    if (!out) return;
    if (typeof v === 'string') out.textContent = v;
    else out.textContent = JSON.stringify(v, null, 2);
  }

  async function call(path, opts) {
    write('Ожидание ответа...');
    try {
      const res = await fetch(path, opts);
      const ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') !== -1) {
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
    return call('/api/testserver/ping', { method: 'GET' });
  }

  async function info() {
    return call('/api/testserver/info', { method: 'GET' });
  }

  // Подключаем обработчики
  if (btnPing) btnPing.addEventListener('click', ping);
  if (btnInfo) btnInfo.addEventListener('click', info);

  // Автопинг при старте (не навязчиво)
  (async function auto() {
    try {
      await ping();
    } catch (e) {
      // ничего не делаем, уже отобразилось в out
    }
  })();
})();


