// vision/vision.js

const API_BASE = "/api/vision";

const state = {
  userId: makeUserId(),
  visionId: null,
};

function makeUserId() {
  // пока просто локальный ID для тестов
  return "local-" + Math.random().toString(36).slice(2);
}

function qs(sel) {
  return document.querySelector(sel);
}

function showError(msg) {
  const box = qs("#visionError");
  box.textContent = msg || "";
  box.classList.toggle("hidden", !msg);
}

function appendMessage(role, text) {
  const list = qs("#messages");
  const item = document.createElement("div");
  item.className = `vision-message vision-message--${role}`;
  const label = role === "user" ? "Ты" : "Система";
  item.innerHTML = `<div class="vision-message-label">${label}</div>
                    <div class="vision-message-text">${escapeHtml(text)}</div>`;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function createVision() {
  showError("");
  try {
    const res = await fetch(`${API_BASE}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: state.userId }),
    });

    if (!res.ok) throw new Error("Ошибка создания визии");

    const data = await res.json();
    state.visionId = data.vision_id;

    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    info.classList.remove("hidden");
    title.textContent = data.title;

    const input = qs("#userInput");
    const btn = qs("#sendBtn");
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  } catch (err) {
    console.error(err);
    showError("Не удалось создать визию. Проверь сервер.");
  }
}

async function sendStep(userText) {
  showError("");
  if (!state.visionId) {
    showError("Сначала создай визию.");
    return;
  }

  appendMessage("user", userText);

  try {
    const res = await fetch(`${API_BASE}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: state.visionId,
        user_text: userText,
      }),
    });

    if (!res.ok) throw new Error("Ошибка шага визии");

    const data = await res.json();
    appendMessage("ai", data.ai_text || "(пустой ответ)");
  } catch (err) {
    console.error(err);
    showError("Ошибка при запросе к ИИ. Смотри логи сервера.");
  }
}

function init() {
  const createBtn = qs("#createVisionBtn");
  const form = qs("#messageForm");
  const input = qs("#userInput");

  createBtn.addEventListener("click", (e) => {
    e.preventDefault();
    createVision();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendStep(text);
  });
}

document.addEventListener("DOMContentLoaded", init);
