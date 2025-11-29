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

// ---- LOAD VISION (title + steps in one request) ----
async function loadVision() {
  const data = await apiGet(`/api/vision/${vision_id}`);

  // title
  titleEl.textContent = data.title || "Без названия";

  // steps
  stepsEl.innerHTML = "";
  (data.steps || []).forEach(s => {
    const row = document.createElement("div");
    row.className = "step-row";

    row.innerHTML = `
      <div class="step-side">${s.user_id === "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" ? "🤖" : "🧑"}</div>
      <div class="step-text">${s.user_text || s.ai_text || ""}</div>
    `;

    stepsEl.appendChild(row);
  });
}

// ---- ADD STEP ----
async function addStep() {
  const text = inputEl.value.trim();
  if (!text) return;

  await apiPost(`/api/vision/step`, {
    vision_id,
    user_text: text,
    with_ai: true
  });

  inputEl.value = "";
  await loadVision();
}

// ---- EDIT TITLE ----
async function editTitle() {
  const newTitle = prompt("Новое название визии:", titleEl.textContent);
  if (!newTitle) return;

  await apiPost(`/api/vision/rename`, {
    vision_id,
    title: newTitle
  });

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
});
