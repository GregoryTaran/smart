// ===== Хелперы =====

async function apiGet(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("GET " + url + " " + r.status);
  return await r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error("POST " + url + " " + r.status);
  return await r.json();
}

// ===== Глобальные элементы =====
const titleEl = document.getElementById("visionTitle");
const editBtn = document.getElementById("editTitleBtn");
const stepsEl = document.getElementById("stepsContainer");
const inputEl = document.getElementById("newStepInput");
const addStepBtn = document.getElementById("addStepBtn");

const backBtn = document.getElementById("backToList");

let vision_id = null;

// ===== Функции =====

function parseVisionId() {
  const p = new URLSearchParams(window.location.search);
  vision_id = p.get("vision_id");
}

async function loadVision() {
  const data = await apiGet(`/api/vision/${vision_id}`);
  titleEl.textContent = data.title || "Без названия";
}

async function loadSteps() {
  const data = await apiGet(`/api/vision/${vision_id}/steps`);
  stepsEl.innerHTML = "";

  (data.steps || []).forEach(s => {
    const row = document.createElement("div");
    row.className = "step-row";

    row.innerHTML = `
      <div class="step-side">${s.role === "ai" ? "🤖" : "🧑"}</div>
      <div class="step-text">${s.text}</div>
    `;

    stepsEl.appendChild(row);
  });
}

async function addStep() {
  const text = inputEl.value.trim();
  if (!text) return;

  await apiPost(`/api/vision/${vision_id}/step/add`, { text });
  inputEl.value = "";
  await loadSteps();
}

async function editTitle() {
  const newTitle = prompt("Новое название визии:", titleEl.textContent);
  if (!newTitle) return;

  await apiPost(`/api/vision/${vision_id}/title`, { title: newTitle });
  titleEl.textContent = newTitle;
}

// ===== Навигация =====
backBtn.addEventListener("click", () => {
  window.location.href = "/vision/index.html";
});

// ===== Старт =====
document.addEventListener("DOMContentLoaded", async () => {
  parseVisionId();

  if (!vision_id) {
    alert("Не передан vision_id");
    return;
  }

  editBtn.addEventListener("click", editTitle);
  addStepBtn.addEventListener("click", addStep);

  await loadVision();
  await loadSteps();
});
