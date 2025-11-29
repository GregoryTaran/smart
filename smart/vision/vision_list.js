// vision_list.js — версия под SMART_SESSION

async function apiGet(url) {
  const res = await fetch(url, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`GET ${url} failed with status ${res.status}`);
  }

  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : "{}",
  });

  if (!res.ok) {
    throw new Error(`POST ${url} failed with status ${res.status}`);
  }

  return res.json();
}

function renderVisionList(visions) {
  const listEl = document.getElementById("visionList");
  if (!listEl) return;

  listEl.innerHTML = "";

  if (!visions || visions.length === 0) {
    listEl.innerHTML = `<p class="vision-list-empty">У вас пока нет визий. Нажмите «Создать визию».</p>`;
    return;
  }

  visions.forEach((v) => {
    const item = document.createElement("div");
    item.className = "vision-list-item";
    item.innerHTML = `
      <div class="vision-list-title">${v.title}</div>
      <div class="vision-list-date">
        ${v.created_at ? new Date(v.created_at).toLocaleString() : ""}
      </div>
    `;

    item.addEventListener("click", () => {
      // ВАЖНО: у нас поле vision_id, а не id
      const id = v.vision_id || v.id;
      if (!id) {
        console.error("Нет vision_id в ответе API", v);
        return;
      }
      window.location.href = `/vision/vision.html?vision_id=${encodeURIComponent(id)}`;
    });

    listEl.appendChild(item);
  });
}

async function loadVisionList() {
  const listEl = document.getElementById("visionList");
  if (listEl) {
    listEl.innerHTML = `<p class="vision-list-loading">Загружаем ваши визии...</p>`;
  }

  try {
    const data = await apiGet("/api/vision/list");
    renderVisionList(data.visions || []);
  } catch (err) {
    console.error("Ошибка загрузки списка визий:", err);
    if (listEl) {
      listEl.innerHTML = `<p class="vision-list-error">Не удалось загрузить список визий. Попробуйте обновить страницу.</p>`;
    }
  }
}

function setupCreateButton() {
  const btn = document.getElementById("newVisionBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Создаём визию...";

    try {
      const data = await apiPost("/api/vision/create");
      const id = data.vision_id;
      if (!id) {
        throw new Error("API не вернуло vision_id");
      }
      window.location.href = `/vision/vision.html?vision_id=${encodeURIComponent(id)}`;
    } catch (err) {
      console.error("Ошибка создания визии:", err);
      alert("Не удалось создать визию. Попробуйте ещё раз.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const session = window.SMART_SESSION;

  if (!session || !session.ready) {
    console.error("SMART_SESSION не инициализирован. Проверь подключение smartid.init.js.");
    const listEl = document.getElementById("visionList");
    if (listEl) {
      listEl.innerHTML = `<p class="vision-list-error">Проблема с авторизацией. Обновите страницу.</p>`;
    }
    return;
  }

  session.ready.then((auth) => {
    if (!auth || !auth.authenticated) {
      const listEl = document.getElementById("visionList");
      if (listEl) {
        listEl.innerHTML = `<p class="vision-list-empty">Для работы с визиями нужно войти в систему.</p>`;
      }
      // Можно редиректить, если хочешь:
      // window.location.href = "/login/login.html";
      return;
    }

    setupCreateButton();
    loadVisionList();
  });
});
