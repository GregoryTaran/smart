// ============================
// API HELPERS
// ============================
async function apiGet(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("GET " + url + " " + r.status);
  return r.json();
}

async function apiPost(url, body = {}) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("POST " + url + " " + r.status);
  return r.json();
}

// ============================
// DOM ELEMENTS
// ============================
const params = new URLSearchParams(location.search);
const visionId = params.get("vision_id");

let titleEl, stepsContainer, inputEl, sendBtn, editBtn;

// ============================
// INIT
// ============================
window.addEventListener("DOMContentLoaded", () => {
  titleEl = document.getElementById("visionTitle");
  stepsContainer = document.getElementById("stepsContainer");
  inputEl = document.getElementById("newStepInput");
  sendBtn = document.getElementById("addStepBtn");
  editBtn = document.getElementById("editTitleBtn");

  if (!visionId) {
    titleEl.textContent = "Визия не выбрана";
    return;
  }

  setupSend();
  setupRename();
  loadVision();
});

// ============================
// LOAD DATA
// ============================
async function loadVision() {
  titleEl.textContent = "Загрузка...";

  try {
    const data = await apiGet(`/api/vision/${visionId}`);
    titleEl.textContent = data.title || "Без названия";

    renderSteps(data.steps || []);
  } catch (err) {
    console.error("Ошибка загрузки визии:", err);
    titleEl.textContent = "Ошибка загрузки визии";
  }
}

// ============================
// RENDER STEPS — КРАСИВЫЙ ЧАТ
// ============================
function renderSteps(steps) {
  stepsContainer.innerHTML = "";

  steps.forEach(step => {
    // USER block
    if (step.user_text) {
      const msg = document.createElement("div");
      msg.className = "vision-message vision-message-user";
      msg.innerHTML = `
        <div class="vision-message-text">${step.user_text}</div>
        <div class="vision-message-label">
          🧑 ${new Date(step.created_at).toLocaleString()}
        </div>
      `;
      stepsContainer.appendChild(msg);
    }

    // AI block
    if (step.ai_text) {
      const msg = document.createElement("div");
      msg.className = "vision-message vision-message-ai";
      msg.innerHTML = `
        <div class="vision-message-text">${step.ai_text}</div>
        <div class="vision-message-label">
          🤖 ${new Date(step.created_at).toLocaleString()}
        </div>
      `;
      stepsContainer.appendChild(msg);
    }
  });

  stepsContainer.scrollTop = stepsContainer.scrollHeight;
}

// ============================
// SEND STEP
// ============================
function setupSend() {
  sendBtn.addEventListener("click", sendStep);

  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendStep();
    }
  });
}

async function sendStep() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";

  try {
    await apiPost("/api/vision/step", {
      vision_id: visionId,
      user_text: text,
      with_ai: true
    });

    loadVision();
  } catch (err) {
    console.error("Ошибка шага:", err);
  }
}

// ============================
// RENAME
// ============================
function setupRename() {
  editBtn.addEventListener("click", async () => {
    const current = titleEl.textContent.trim();
    const newName = prompt("Новое название визии:", current);
    if (!newName) return;

    try {
      await apiPost("/api/vision/rename", {
        vision_id: visionId,
        title: newName
      });

      titleEl.textContent = newName;
    } catch (err) {
      console.error("Ошибка переименования:", err);
      alert("Не удалось переименовать визию");
    }
  });
}
