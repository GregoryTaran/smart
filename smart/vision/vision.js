// vision.js — визия под новую авторизацию SMART_SESSION

async function apiGet(url) {
  const res = await fetch(url, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`GET ${url} failed with status ${res.status}`);
  }

  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  if (!res.ok) {
    throw new Error(`POST ${url} failed with status ${res.status}`);
  }

  return res.json();
}

function appendStep(step) {
  const list = document.getElementById("messages");
  if (!list) return;

  const item = document.createElement("div");
  item.className = "vision-step-item";

  const createdAt = step.created_at
    ? new Date(step.created_at).toLocaleString()
    : "";

  item.innerHTML = `
    <div class="vision-step-meta">
      <span class="vision-step-author">
        ${step.is_ai ? "AI" : "Вы"}
      </span>
      <span class="vision-step-date">${createdAt}</span>
    </div>
    <div class="vision-step-user">${step.user_text || ""}</div>
    ${
      step.ai_text
        ? `<div class="vision-step-ai">${step.ai_text}</div>`
        : ""
    }
  `;

  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

function renderSteps(steps) {
  const list = document.getElementById("messages");
  if (!list) return;

  list.innerHTML = "";
  (steps || []).forEach((s) => appendStep(s));
}

async function loadVision(visionId) {
  const titleEl = document.getElementById("visionTitle");
  const errorEl = document.getElementById("visionError");

  if (errorEl) {
    errorEl.classList.add("vision-hidden");
    errorEl.textContent = "";
  }

  const messages = document.getElementById("messages");
  if (messages) {
    messages.innerHTML = `<div class="vision-loading">Загружаем визию...</div>`;
  }

  try {
    const data = await apiGet(`/api/vision/${encodeURIComponent(visionId)}`);

    if (titleEl) titleEl.textContent = data.title || "Визия";

    renderSteps(data.steps || []);
  } catch (err) {
    console.error("Ошибка загрузки визии:", err);
    if (errorEl) {
      errorEl.textContent =
        "Не удалось загрузить визию. Попробуйте обновить страницу.";
      errorEl.classList.remove("vision-hidden");
    }
  }
}

async function sendStep(visionId, text) {
  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  if (sendBtn) {
    sendBtn.disabled = true;
  }

  try {
    const data = await apiPost("/api/vision/step", {
      vision_id: visionId,
      user_text: text,
    });

    if (data.step) {
      appendStep(data.step);
    } else {
      // на всякий случай — если вернули весь объект визии
      if (data.steps) renderSteps(data.steps);
    }
  } catch (err) {
    console.error("Ошибка отправки шага:", err);
    alert("Не удалось добавить шаг. Попробуйте ещё раз.");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const url = new URL(window.location.href);
  const visionId = url.searchParams.get("vision_id");

  if (!visionId) {
    alert("Не передан идентификатор визии.");
    window.location.href = "/vision/index.html";
    return;
  }

  // Кнопка "назад ко всем визиям"
  const backBtn = document.getElementById("backToListBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "/vision/index.html";
    });
  }

  const session = window.SMART_SESSION;
  if (!session || !session.ready) {
    console.error("SMART_SESSION не инициализирован. Проверь подключение smartid.init.js.");
    alert("Проблема с авторизацией. Обновите страницу.");
    return;
  }

  const auth = await session.ready;
  if (!auth || !auth.authenticated) {
    alert("Для работы с визиями нужно войти в систему.");
    window.location.href = "/login/login.html";
    return;
  }

  const form = document.getElementById("messageForm");
  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  if (form && input) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      sendStep(visionId, text);
    });
  }

  // Дополнительно: Enter отправляет, Shift+Enter — новая строка
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        sendStep(visionId, text);
      }
    });
  }

  // первая загрузка визии
  loadVision(visionId);
});
