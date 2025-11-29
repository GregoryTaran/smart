// vision.js — версия под SMART_SESSION + Vision API v3

// ------------------------- API HELPERS -------------------------
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

// ------------------------- GLOBALS -----------------------------
const params = new URLSearchParams(window.location.search);
const visionId = params.get("vision_id");

let titleEl;
let messagesEl;
let inputEl;
let sendBtn;
let renameBtn;
let errorEl;

// ---------------------- INITIALIZATION -------------------------
window.addEventListener("DOMContentLoaded", async () => {
  if (!window.SMART_SESSION || !window.SMART_SESSION.ready) {
    console.error("SMART_SESSION не инициализирован");
    alert("Ошибка инициализации авторизации");
    return;
  }

  const session = await window.SMART_SESSION.ready;

  if (!session.authenticated) {
    alert("Для работы с визиями нужно войти в систему");
    window.location.href = "/login/login.html";
    return;
  }

  // Привязка DOM
  titleEl = document.getElementById("visionTitle");
  messagesEl = document.getElementById("messages");
  inputEl = document.getElementById("userInput");
  sendBtn = document.getElementById("sendBtn");
  renameBtn = document.getElementById("renameVisionBtn");
  errorEl = document.getElementById("visionError");

  if (!visionId) {
    if (titleEl) titleEl.innerText = "Визия не выбрана";
    disableInput();
    return;
  }

  setupForm();
  setupRename();
  loadVision();
});

// ------------------------- LOAD VISION --------------------------
function loadVision() {
  if (titleEl) {
    titleEl.innerText = "Загрузка...";
  }
  hideError();

  apiGet(`/api/vision/${visionId}`)
    .then(data => {
      if (titleEl) {
        titleEl.innerText = data.title || "Без названия";
      }
      renderMessages(data.steps || []);
      enableInput();
    })
    .catch(err => {
      console.error(err);
      if (titleEl) {
        titleEl.innerText = "Ошибка загрузки визии";
      }
      showError("Не удалось загрузить визию");
      disableInput();
    });
}

// ------------------------ SEND STEP -----------------------------
function setupForm() {
  const form = document.getElementById("messageForm");
  if (!form || !inputEl || !sendBtn) {
    console.warn("messageForm / userInput / sendBtn не найдены");
    return;
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    sendStep();
  });

  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendStep();
    }
  });
}

function sendStep() {
  if (!inputEl) return;

  const text = inputEl.value.trim();
  if (!text) return;

  hideError();
  inputEl.value = "";
  disableInput();

  apiPost("/api/vision/step", {
    vision_id: visionId,
    user_text: text
  })
    .then(() => loadVision())
    .catch(err => {
      console.error(err);
      showError("Не удалось отправить шаг");
      enableInput();
    });
}

// ------------------------ RENAME VISION -------------------------
function setupRename() {
  if (!renameBtn || !titleEl) return;

  renameBtn.disabled = false;

  renameBtn.addEventListener("click", () => {
    const currentTitle = titleEl.innerText.trim() || "Моя визия";
    const newName = window.prompt("Введите новое название визии:", currentTitle);
    if (!newName) return;

    hideError();
    renameBtn.disabled = true;

    apiPost("/api/vision/rename", {
      vision_id: visionId,
      title: newName
    })
      .then(() => {
        renameBtn.disabled = false;
        loadVision();
      })
      .catch(err => {
        console.error(err);
        showError("Не удалось переименовать визию");
        renameBtn.disabled = false;
      });
  });
}

// ------------------------ RENDER MESSAGES -----------------------
function renderMessages(steps) {
  if (!messagesEl) return;

  messagesEl.innerHTML = "";

  steps.forEach(step => {
    // сообщение пользователя
    if (step.user_text) {
      const userMsg = document.createElement("div");
      userMsg.className = "vision-message vision-message-user";
      userMsg.innerHTML = `
        <div class="vision-message-label">Вы</div>
        <div class="vision-message-text">${step.user_text}</div>
        <div class="vision-message-time">
          ${new Date(step.created_at).toLocaleString()}
        </div>
      `;
      messagesEl.appendChild(userMsg);
    }

    // ответ ИИ (если есть)
    if (step.ai_text) {
      const aiMsg = document.createElement("div");
      aiMsg.className = "vision-message vision-message-ai";
      aiMsg.innerHTML = `
        <div class="vision-message-label">SMART VISION</div>
        <div class="vision-message-text">${step.ai_text}</div>
        <div class="vision-message-time">
          ${new Date(step.created_at).toLocaleString()}
        </div>
      `;
      messagesEl.appendChild(aiMsg);
    }
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ----------------------------- UI -------------------------------
function disableInput() {
  if (inputEl) inputEl.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
}

function enableInput() {
  if (inputEl) inputEl.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
}

function showError(text) {
  if (!errorEl) return;
  errorEl.innerText = text;
  errorEl.classList.remove("vision-hidden");
}

function hideError() {
  if (!errorEl) return;
  errorEl.innerText = "";
  errorEl.classList.add("vision-hidden");
}
