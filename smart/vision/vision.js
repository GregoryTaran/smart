// --- API ---

async function apiGet(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

function getVisionId() {
  return new URLSearchParams(location.search).get("vision_id");
}

// --- РЕНДЕР НАЗВАНИЯ ---

function renderVisionTitle(v) {
  document.getElementById("visionTitle").textContent = v.title || "Без названия";
}

// --- РЕНДЕР ШАГОВ ---

function renderSteps(steps) {
  const list = document.getElementById("stepsList");
  list.innerHTML = "";

  if (!steps || steps.length === 0) {
    list.innerHTML = `<div class="vision-message">Пока нет шагов.</div>`;
    return;
  }

  for (const s of steps) {
    const block = document.createElement("div");

    // классы из твоего vision.css
    block.className = "vision-message " + 
      (s.user_text && !s.ai_text ? "vision-message-user" : "") +
      (s.ai_text ? "vision-message-ai" : "");

    const who = s.user_text ? "Пользователь" : "AI";
    const text = s.user_text || s.ai_text;

    block.innerHTML = `
      <div class="vision-message-label">${who}</div>
      <div class="vision-message-text">${text}</div>
    `;

    list.appendChild(block);
  }
}

// --- ЗАГРУЗКА СТРАНИЦЫ ---

async function loadVision() {
  const id = getVisionId();
  if (!id) return alert("vision_id отсутствует");

  try {
    const data = await apiGet(`/api/vision/get?vision_id=${id}`);
    renderVisionTitle(data.vision);
    renderSteps(data.steps || []);
  } catch (e) {
    console.error(e);
    showError("Ошибка загрузки визии");
  }
}

function showError(msg) {
  const el = document.getElementById("visionError");
  el.textContent = msg;
  el.classList.remove("vision-hidden");
}

// --- ОТПРАВКА ШАГА ---

async function sendStep() {
  const id = getVisionId();
  const textarea = document.getElementById("newStepText");
  const text = textarea.value.trim();
  if (!text) return;

  try {
    await apiPost("/api/vision/step", { vision_id: id, user_text: text });
    textarea.value = "";
    await loadVision();
  } catch (e) {
    console.error(e);
    showError("Не удалось отправить шаг");
  }
}

// --- РЕДАКТИРОВАНИЕ НАЗВАНИЯ ---

function openEdit() {
  document.getElementById("editTitleBlock").classList.remove("vision-hidden");
  document.getElementById("editVisionBtn").classList.add("vision-hidden");
}

function closeEdit() {
  document.getElementById("editTitleBlock").classList.add("vision-hidden");
  document.getElementById("editVisionBtn").classList.remove("vision-hidden");
}

async function saveTitle() {
  const id = getVisionId();
  const val = document.getElementById("editTitleInput").value.trim();
  if (!val) return;

  try {
    await apiPost("/api/vision/update", {
      vision_id: id,
      title: val
    });

    closeEdit();
    await loadVision();
  } catch (e) {
    console.error(e);
    showError("Ошибка сохранения");
  }
}

// --- ИНИЦИАЛИЗАЦИЯ ---

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sendBtn").onclick = sendStep;
  document.getElementById("backBtn").onclick = () => location.href = "/vision/index.html";

  document.getElementById("editVisionBtn").onclick = openEdit;
  document.getElementById("cancelEditBtn").onclick = closeEdit;
  document.getElementById("saveTitleBtn").onclick = saveTitle;

  loadVision();
});
