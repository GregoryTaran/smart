// --- API HELPERS ---
async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("GET " + url);
  return await res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("POST " + url);
  return await res.json();
}

document.addEventListener("sv:auth-ready", () => {
  loadVisionList();
  setupCreateButton();
});

// Загрузка списка визий
function loadVisionList() {
  apiGet("/api/vision/list")
    .then(data => renderList(data.visions || []))
    .catch(err => console.error("Ошибка загрузки визий", err));
}

// Рендер списка
function renderList(visions) {
  const box = document.getElementById("visionList");
  box.innerHTML = "";

  if (visions.length === 0) {
    box.innerHTML = `<p class="empty-text">У вас пока нет визий</p>`;
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
      window.location.href = `/vision/vision.html?vision_id=${v.vision_id}`;
    };
    box.appendChild(item);
  });
}

// Создание визии
function setupCreateButton() {
  const btn = document.getElementById("newVisionBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    apiPost("/api/vision/create", {})
      .then(data => {
        window.location.href = `/vision/vision.html?vision_id=${data.vision_id}`;
      })
      .catch(err => console.error("Ошибка создания визии", err));
  });
}
