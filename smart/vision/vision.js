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

// Получаем ID визии
const params = new URLSearchParams(location.search);
const visionId = params.get("vision_id");

document.addEventListener("sv:auth-ready", () => {
  if (visionId) {
    loadVision();
    setupForm();
    setupRename();
  }
});

// Загрузка визии
function loadVision() {
  apiGet(`/api/vision/${visionId}`)
    .then(data => {
      document.getElementById("visionTitle").innerText = data.title;
      renderMessages(data.steps || []);
      enableInput();
    })
    .catch(err => {
      console.error("Ошибка загрузки визии", err);
      showError("Не удалось загрузить визию");
    });
}

// Рендер сообщений
function renderMessages(steps) {
  const box = document.getElementById("messages");
  box.innerHTML = "";

  steps.forEach(step => {
    const userMsg = document.createElement("div");
    userMsg.className = "vision-message vision-message-user";
    userMsg.innerHTML = `
      <div class="vision-message-text">${step.user_text}</div>
      <div class="vision-message-time">${new Date(step.created_at).toLocaleString()}</div>
    `;
    box.appendChild(userMsg);

    if (step.ai_text) {
      const aiMsg = document.createElement("div");
      aiMsg.className = "vision-message vision-message-ai";
      aiMsg.innerHTML = `
        <div class="vision-message-text">${step.ai_text}</div>
        <div class="vision-message-time">${new Date(step.created_at).toLocaleString()}</div>
      `;
      box.appendChild(aiMsg);
    }
  });

  box.scrollTop = box.scrollHeight;
}

// Отправка шага
function setupForm() {
  const form = document.getElementById("messageForm");
  form.addEventListener("submit", e => {
    e.preventDefault();
    sendStep();
  });
}

function sendStep() {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";

  apiPost("/api/vision/step", {
    vision_id: visionId,
    user_text: text
  })
    .then(() => loadVision())
    .catch(err => {
      console.error("Ошибка отправки шага", err);
      showError("Не удалось отправить шаг");
    });
}

// Переименование визии
function setupRename() {
  const btn = document.getElementById("renameVisionBtn");
  btn.disabled = false;

  btn.onclick = () => {
    const newName = prompt("Введите новое название визии:");
    if (!newName) return;

    apiPost("/api/vision/rename", {
      vision_id: visionId,
      title: newName
    })
      .then(() => loadVision())
      .catch(err => {
        console.error("Ошибка переименования", err);
        showError("Не удалось переименовать визию");
      });
  };
}

// UI helpers
function enableInput() {
  document.getElementById("userInput").disabled = false;
  document.getElementById("sendBtn").disabled = false;
}

function showError(text) {
  const block = document.getElementById("visionError");
  block.innerText = text;
  block.classList.remove("vision-hidden");
}
