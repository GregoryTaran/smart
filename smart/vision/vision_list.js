// vision_list.js — версия под SMART_SESSION + Vision API

async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("GET " + url + " " + res.status);
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("POST " + url + " " + res.status);
  return res.json();
}

window.addEventListener("DOMContentLoaded", () => {
  // Ждём готовности SMART_SESSION (новая auth-система)
  if (!window.SMART_SESSION || !window.SMART_SESSION.ready) {
    console.error("SMART_SESSION не инициализирован");
    const box = document.getElementById("visionList");
    if (box) {
      box.innerHTML = `<p class="empty-text">Ошибка инициализации авторизации</p>`;
    }
    return;
  }

  window.SMART_SESSION.ready.then(session => {
    if (!session.authenticated) {
      const box = document.getElementById("visionList");
      if (box) {
        box.innerHTML = `<p class="empty-text">Для визий нужен вход в систему</p>`;
      }
      return;
    }

    setupCreateButton();
    loadVisionList();
  });
});

function loadVisionList() {
  apiGet(`/api/vision/list`)
    .then(data => renderList(data.visions || []))
    .catch(err => {
      console.error(err);
      const box = document.getElementById("visionList");
      if (box) {
        box.innerHTML = `<p class="empty-text">Не удалось загрузить визии</p>`;
      }
    });
}

function renderList(visions) {
  const box = document.getElementById("visionList");
  if (!box) return;

  box.innerHTML = "";

  if (!visions.length) {
    box.innerHTML = `<p class="vision-list-empty">У вас пока нет визий</p>`;
    return;
  }

  visions.forEach(v => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vision-list-item";
    item.innerHTML = `
      <div class="vision-list-title">${v.title}</div>
      <div class="vision-list-date">${new Date(v.created_at).toLocaleString()}</div>
    `;
    item.onclick = () => {
      window.location.href = `/vision/vision.html?vision_id=${v.vision_id}`;
    };
    box.appendChild(item);
  });
}

function setupCreateButton() {
  const btn = document.getElementById("newVisionBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      const data = await apiPost("/api/vision/create");
      if (!data || !data.vision_id) {
        throw new Error("Некорректный ответ create");
      }
      window.location.href = `/vision/vision.html?vision_id=${data.vision_id}`;
    } catch (err) {
      console.error(err);
      alert("Не удалось создать визию");
    }
  });
}
