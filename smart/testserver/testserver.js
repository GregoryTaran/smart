// /testserver/testserver.js
document.addEventListener("DOMContentLoaded", async () => {
  const out = document.getElementById("pingBox");
  if (!out) return;

  // 1) Определяем базовый URL API
  // - если фронт запущен локально на 127.0.0.1:5500 → идём на 127.0.0.1:8000
  // - иначе (прод) → используем тот же origin (относительный путь)
  const isLocal = location.origin.includes("127.0.0.1:5500");
  const API_BASE = isLocal ? "http://127.0.0.1:8000" : location.origin;

  const fetchJSON = async (url, opts) => {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${JSON.stringify(data)}`);
    return data;
  };

  // 2) Пингуем бэк
  try {
    const data = await fetchJSON(`${API_BASE}/api/testserver/ping`, { cache: "no-cache" });
    out.textContent = `OK: ${JSON.stringify(data)}`;
  } catch (e) {
    out.textContent = `Ошибка связи с API: ${e.message}`;
    console.warn(e);
  }

  // 3) (опционально) добавим быстрые кнопки для records
  const btnList = document.getElementById("btnList");
  const btnCreate = document.getElementById("btnCreate");
  const listOut = document.getElementById("listOut");

  if (btnList && btnCreate && listOut) {
    btnList.onclick = async () => {
      try {
        const data = await fetchJSON(`${API_BASE}/api/db/records`);
        listOut.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        listOut.textContent = `Ошибка GET /records: ${e.message}`;
      }
    };

    btnCreate.onclick = async () => {
      try {
        const body = { title: "Hello from TestServer", meta: { source: "testserver" } };
        const data = await fetchJSON(`${API_BASE}/api/db/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        listOut.textContent = "Создано: " + JSON.stringify(data, null, 2);
      } catch (e) {
        listOut.textContent = `Ошибка POST /records: ${e.message}`;
      }
    };
  }
});
