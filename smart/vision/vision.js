// vision.js — финальная версия под AUTH v3 + новый vision_api

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
const params = new URLSearchParams(location.search);
const visionId = params.get("vision_id");

let titleEl, messagesEl, inputEl, sendBtn, renameBtn, errorEl;

// ---------------------- INITIALIZATION -------------------------
window.addEventListener("DOMContentLoaded", async () => {
  // Ждём AUTH
  const auth = await window.SV_AUTH.ready;

  if (!auth.isAuthenticated) {
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
    titleEl.innerText = "Визия не выбрана";
    disableInput();
    return;
  }

  // Старт
  setupForm();
  setupRename();
  loadVision();
});


// ------------------------- LOAD VISION --------------------------
function loadVision() {
  titleEl.innerText = "Загрузка...";

  apiGet(`/api/vision/${visionId}`)
    .then(data => {
      titleEl.innerText = data.title || "Без названия";
      renderMessages(data.steps || []);
      enableInput();
    })
    .catch(err => {
      console.error(err);
      titleEl.innerText = "Ошибка загрузки визии";
      showError("Не удалось загрузить визию");
      disableInput();
    });
}


// ------------------------ SEND STEP -----------------------------
function setupForm() {
  const form = document.getElementById("messageForm");
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
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";

  apiPost("/api/vision/step", {
    vision_id: visionId,
    user_text: text
  })
    .then(() => loadVision())
    .catch(err => {
      console.error(err);
      showError("Не удалось отправить шаг");
    });
}


// ------------------------ RENAME VISION -------------------------
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
      .then(() => loadVision())
      .catch(err => {
        console.error(err);
        showError("Не удалось переименовать визию");
      });
  };
}


// ------------------------ RENDER MESSAGES -----------------------
function renderMessages(steps) {
  messagesEl.innerHTML = "";

  steps.forEach(step => {
    const userMsg = document.createElement("div");
    userMsg.className = "vision-message vision-message-user";
    userMsg.innerHTML = `
      <div class="vision-message-text">${step.user_text}</div>
      <div class="vision-message-time">${new Date(step.created_at).toLocaleString()}</div>
    `;
    messagesEl.appendChild(userMsg);

    if (step.ai_text) {
      const aiMsg = document.createElement("div");
      aiMsg.className = "vision-message vision-message-ai";
      aiMsg.innerHTML = `
        <div class="vision-message-text">${step.ai_text}</div>
        <div class="vision-message-time">${new Date(step.created_at).toLocaleString()}</div>
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
  errorEl.innerText = text;
  errorEl.classList.remove("vision-hidden");
}

function hideError() {
  errorEl.innerText = "";
  errorEl.classList.add("vision-hidden");
}
