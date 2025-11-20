// --- API HELPERS ---
async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("GET " + url + " " + res.status);
  return await res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("POST " + url + " " + res.status);
  return await res.json();
}

// --------------------------------------------------------
// ПРОСТО: когда DOM готов — грузим визии
// --------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  setupCreateButton();
  loadVisionList();
});

// Загрузка списка визий
function loadVisionList() {
  apiGet("/api/vision/list")
    .then(data => renderList(data.visions || []))
    .catch(err => {
      console.error("Ошибка загрузки визий", err);
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
      // Абсолютный путь — чтобы вообще никогда не промахнуться
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
      .catch(err => {
        console.error("Ошибка создания визии", err);
      });
  });
}
