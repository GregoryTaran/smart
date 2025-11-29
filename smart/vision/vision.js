// =========================
// API HELPERS
// =========================

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

// =========================
// ГЛОБАЛЬНЫЕ ЭЛЕМЕНТЫ
// =========================

const params = new URLSearchParams(location.search);
const visionId = params.get("vision_id");

let titleEl, messagesEl, inputEl, sendBtn, renameBtn, errorEl;

// =========================
// ИНИЦИАЛИЗАЦИЯ
// =========================

window.addEventListener("DOMContentLoaded", () => {
  titleEl = document.getElementById("visionTitle");
  messagesEl = document.getElementById("messages");
  inputEl = document.getElementById("userInput");
  sendBtn = document.getElementById("sendBtn");
  renameBtn = document.getElementById("renameVisionBtn");
  errorEl = document.getElementById("visionError");

  if (!visionId) {
    titleEl.innerText = "Визия не выбрана";
    disableInput();
    return;
  }

  setupForm();
  setupRename();
  loadVision();
});

// =========================
// ЗАГРУЗКА ВИЗИИ
// =========================

function loadVision() {
  titleEl.innerText = "Загрузка...";

  apiGet(`/api/vision/${visionId}`)
    .then(data => {
      titleEl.innerText = data.title || "Без названия";
      hideError();
      renderMessages(data.steps || []);
      enableInput();
    })
    .catch(err => {
      console.error("Ошибка загрузки визии:", err);
      titleEl.innerText = "Ошибка загрузки визии";
      showError("Не удалось загрузить визию. Попробуйте обновить страницу.");
      disableInput();
    });
}

// =========================
// РЕНДЕР ШАГОВ (КРАСИВЫЙ)
// =========================

function renderMessages(steps) {
  if (!messagesEl) return;
  messagesEl.innerHTML = "";

  steps.forEach(step => {
    // USER (если есть user_text)
    if (step.user_text && step.user_text.trim() !== "") {
      const userMsg = document.createElement("div");
      userMsg.className = "vision-message vision-message-user";
      userMsg.innerHTML = `
        <div class="vision-message-text">${step.user_text}</div>
        <div class="vision-message-label">
          🧑 ${new Date(step.created_at).toLocaleString()}
        </div>
      `;
      messagesEl.appendChild(userMsg);
    }

    // AI (если есть ai_text)
    if (step.ai_text && step.ai_text.trim() !== "") {
      const aiMsg = document.createElement("div");
      aiMsg.className = "vision-message vision-message-ai";
      aiMsg.innerHTML = `
        <div class="vision-message-text">${step.ai_text}</div>
        <div class="vision-message-label">
          🤖 ${new Date(step.created_at).toLocaleString()}
        </div>
      `;
      messagesEl.appendChild(aiMsg);
    }
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// =========================
// ОТПРАВКА ШАГА
// =========================

function setupForm() {
  const form = document.getElementById("messageForm");
  if (!form || !inputEl) return;

  // Submit отправляет шаг
  form.addEventListener("submit", e => {
    e.preventDefault();
    sendStep();
  });

  // Ctrl+Enter отправляет шаг
  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendStep();
    }
  });
}

function sendStep() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";

  apiPost("/api/vision/step", {
    vision_id: visionId,
    user_text: text,
    with_ai: true
  })
    .then(() => {
      hideError();
      loadVision();
    })
    .catch(err => {
      console.error("Ошибка шага:", err);
      showError("Не удалось отправить шаг. Попробуйте ещё раз.");
    });
}

// =========================
// ПЕРЕИМЕНОВАНИЕ
// =========================

function setupRename() {
  renameBtn.disabled = false;

  renameBtn.onclick = () => {
    const currentTitle = titleEl.innerText.trim();
    const newName = prompt("Введите новое название визии:", currentTitle);
    if (!newName) return;

    apiPost("/api/vision/rename", {
      vision_id: visionId,
      title: newName
    })
      .then(() => {
        hideError();
        loadVision();
      })
      .catch(err => {
        console.error("Ошибка переименования:", err);
        showError("Не удалось переименовать визию.");
      });
  };
}

// =========================
// UI HELPERS
// =========================

function disableInput() {
  inputEl.disabled = true;
  sendBtn.disabled = true;
}

function enableInput() {
  inputEl.disabled = false;
  sendBtn.disabled = false;
}

function showError(text) {
  errorEl.innerText = text;
  errorEl.classList.remove("vision-hidden");
}

function hideError() {
  errorEl.innerText = "";
  errorEl.classList.add("vision-hidden");
}
