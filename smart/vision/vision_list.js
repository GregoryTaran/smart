// vision_list.js — новая финальная версия без user_id в URL

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
  window.SV_AUTH.ready.then(auth => {
    if (!auth.isAuthenticated) {
      document.getElementById("visionList").innerHTML =
        `<p class="empty-text">Для визий нужен вход в систему</p>`;
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
      const box = document.getElementById("visionList");
      box.innerHTML = `<p class="empty-text">Не удалось загрузить визии</p>`;
    });
}

function renderList(visions) {
  const box = document.getElementById("visionList");
  box.innerHTML = "";

  if (!visions.length) {
    box.innerHTML = `<p class="vision-list-empty">У вас пока нет визий</p>`;
    return;
  }

  visions.forEach(v => {
    const item = document.createElement("div");
    item.className = "vision-list-item";
    item.innerHTML = `
      <div class="vision-list-title">${v.title}</div>
      <div class="vision-list-date">${new Date(v.created_at).toLocaleString()}</div>
    `;
    item.onclick = () => {
      window.location.href = \`/vision/vision.html?vision_id=\${v.vision_id}\`;
    };
    box.appendChild(item);
  });
}

function setupCreateButton() {
  const btn = document.getElementById("newVisionBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const data = await apiPost("/api/vision/create");
    window.location.href =
      \`/vision/vision.html?vision_id=\${data.vision_id}\`;
  });
}
