// vision_list.js — чистая версия под /api/vision/*

// ---------- Базовые хелперы ----------

async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error("GET " + url + " " + res.status);
  }
  return await res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    throw new Error("POST " + url + " " + res.status);
  }
  return await res.json();
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ---------- Рендер списка визий ----------

function renderVisionList(visions) {
  const listEl = document.getElementById("visionList");
  if (!listEl) return;

  listEl.innerHTML = "";

  if (!Array.isArray(visions) || visions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "vision-empty";
    empty.textContent = "Пока нет визий. Создай первую.";
    listEl.appendChild(empty);
    return;
  }

  visions.forEach(v => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vision-list-item";

    const titleEl = document.createElement("div");
    titleEl.className = "vision-list-title";
    titleEl.textContent = v.title || "Без названия";

    const metaEl = document.createElement("div");
    metaEl.className = "vision-list-meta";
    metaEl.textContent = formatDate(v.created_at);

    item.appendChild(titleEl);
    item.appendChild(metaEl);

    item.addEventListener("click", () => {
      // index.html лежит в /vision/, поэтому просто относительный путь
      window.location.href =
        `vision.html?vision_id=${encodeURIComponent(v.vision_id)}`;
    });

    listEl.appendChild(item);
  });
}

// ---------- Загрузка с сервера ----------

async function loadVisionList() {
  try {
    const data = await apiGet("/api/vision/list");
    renderVisionList(data.visions || []);
  } catch (err) {
    console.error("Ошибка загрузки списка визий", err);
    const listEl = document.getElementById("visionList");
    if (listEl) {
      listEl.innerHTML = "";
      const errEl = document.createElement("div");
      errEl.className = "vision-error";
      errEl.textContent = "Не удалось загрузить визии. Обнови страницу.";
      listEl.appendChild(errEl);
    }
  }
}

// ---------- Кнопка «Создать новую визию» ----------

function setupCreateButton() {
  const btn = document.getElementById("newVisionBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const data = await apiPost("/api/vision/create", {});
      if (!data || !data.vision_id) {
        throw new Error("Пустой ответ от API /api/vision/create");
      }

      window.location.href =
        `vision.html?vision_id=${encodeURIComponent(data.vision_id)}`;
    } catch (err) {
      console.error("Ошибка создания визии", err);
      alert("Не удалось создать визию. Попробуй ещё раз.");
      btn.disabled = false;
    }
  });
}

// ---------- Старт ----------

document.addEventListener("DOMContentLoaded", () => {
  setupCreateButton();
  loadVisionList();
});
