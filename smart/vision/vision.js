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

// Получаем ID визии из URL
const params = new URLSearchParams(location.search);
const visionId = params.get("vision_id");

let titleEl, messagesEl, inputEl, sendBtn, renameBtn, errorEl;

// ---------------- ИНИЦИАЛИЗАЦИЯ ----------------
window.addEventListener("DOMContentLoaded", () => {
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

// --------------- Загрузка визии ----------------
function loadVision() {
  if (titleEl) titleEl.innerText = "Загрузка...";

  apiGet(`/api/vision/${visionId}`)
    .then(data => {
      if (titleEl) titleEl.innerText = data.title || "Без названия";
      hideError();
      renderMessages(data.steps || []);
      enableInput();
    })
    .catch(err => {
      console.error("Ошибка загрузки визии:", err);
      if (titleEl) titleEl.innerText = "Ошибка загрузки визии";
      showError("Не удалось загрузить визию. Попробуйте обновить страницу.");
      disableInput();
    });
}

// --------------- Сообщения ----------------
function renderMessages(steps) {
  if (!messagesEl) return;
  messagesEl.innerHTML = "";

  steps.forEach(step => {
    // Сообщение пользователя
    const userMsg = document.createElement("div");
    userMsg.className = "vision-message vision-message-user";
    userMsg.innerHTML = `
      <div class="vision-message-text">${step.user_text}</div>
      <div class="vision-message-time">${new Date(step.created_at).toLocaleString()}</div>
    `;
    messagesEl.appendChild(userMsg);

    // Ответ ИИ (если есть)
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

// --------------- Отправка шага ----------------
function setupForm() {
  const form = document.getElementById("messageForm");
  if (!form || !inputEl) return;

  // Отправка по submit (кнопка "Отправить")
  form.addEventListener("submit", e => {
    e.preventDefault();
    sendStep();
  });

  // Отправка по Ctrl+Enter / Cmd+Enter
  inputEl.addEventListener("keydown", e => {
    // Ctrl+Enter (Windows/Linux) или Cmd+Enter (Mac)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); // не добавляем перенос строки
      sendStep();
    }
  });
}


function sendStep() {
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";

  apiPost("/api/vision/step", {
    vision_id: visionId,
    user_text: text
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

// --------------- Переименование ----------------
function setupRename() {
  if (!renameBtn) return;

  renameBtn.disabled = false;
  renameBtn.onclick = () => {
    const currentTitle = titleEl ? titleEl.innerText.trim() : "";
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

// --------------- UI helpers ----------------
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
