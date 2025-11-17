// vision/vision.js
// -----------------------------------------------------------
// Модуль "Путь по визии"
// - использует новую систему идентификации (window.SV_AUTH)
// - поддерживает несколько визий на пользователя
// - даёт выбрать любую визию из списка
// - позволяет переименовывать текущую визию
// -----------------------------------------------------------

const API_BASE = "/api/vision";

const state = {
  userId: null,
  visions: [],
  currentVisionId: null,
  isLoading: false,
  isSending: false,
};

function $(id) {
  return document.getElementById(id);
}

const els = {
  messages: null,
  form: null,
  input: null,
  sendBtn: null,
  error: null,
  overlay: null,
  visionList: null,
  newVisionBtn: null,
  visionTitle: null,
  renameBtn: null,
};

function setError(msg) {
  if (!els.error) return;
  if (!msg) {
    els.error.textContent = "";
    els.error.classList.add("vision-hidden");
  } else {
    els.error.textContent = msg;
    els.error.classList.remove("vision-hidden");
  }
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  if (els.overlay) {
    els.overlay.hidden = !isLoading;
  }
  if (els.input) els.input.disabled = isLoading || !state.currentVisionId;
  if (els.sendBtn) els.sendBtn.disabled = isLoading || !state.currentVisionId;
}

function appendMessage(role, text) {
  if (!els.messages) return;
  const item = document.createElement("div");
  item.className =
    role === "user"
      ? "vision-message vision-message-user"
      : "vision-message vision-message-ai";
  item.textContent = text;
  els.messages.appendChild(item);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function clearMessages() {
  if (!els.messages) return;
  els.messages.innerHTML = "";
}

// ---------- Auth ----------

function waitForAuth() {
  return new Promise((resolve) => {
    if (window.SV_AUTH) {
      const a = window.SV_AUTH;
      if (a.user_id || a.userId) {
        return resolve(a);
      }
    }

    document.addEventListener(
      "sv:auth-ready",
      (ev) => {
        const a = window.SV_AUTH || (ev && ev.detail) || {};
        resolve(a);
      },
      { once: true },
    );
  });
}

// ---------- API ----------

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: body ? JSON.stringify(body) : "{}",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

// ---------- Логика визий ----------

async function loadVisions() {
  setError("");
  try {
    const data = await apiGet("/list");
    state.visions = Array.isArray(data.visions) ? data.visions : [];
    renderVisionList();
  } catch (e) {
    console.error("[VISION] loadVisions error:", e);
    setError("Не удалось загрузить список визий. Попробуй обновить страницу.");
  }
}

function renderVisionList() {
  if (!els.visionList) return;
  els.visionList.innerHTML = "";

  if (!state.visions.length) {
    const empty = document.createElement("div");
    empty.className = "vision-list-empty";
    empty.textContent = "У тебя пока нет визий. Создай первую!";
    els.visionList.appendChild(empty);
    return;
  }

  state.visions.forEach((v) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vision-list-item";
    if (state.currentVisionId === v.vision_id) {
      item.classList.add("vision-list-item-active");
    }

    const title = document.createElement("div");
    title.className = "vision-list-title";
    title.textContent = v.title || "Без названия";

    const date = document.createElement("div");
    date.className = "vision-list-date";
    try {
      const d = new Date(v.created_at);
      date.textContent = d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      date.textContent = "";
    }

    item.appendChild(title);
    item.appendChild(date);

    item.addEventListener("click", () => {
      if (state.currentVisionId === v.vision_id) return;
      selectVision(v.vision_id);
    });

    els.visionList.appendChild(item);
  });
}

async function selectVision(visionId) {
  if (!visionId) return;
  setLoading(true);
  setError("");
  clearMessages();
  state.currentVisionId = visionId;
  renderVisionList();

  try {
    const data = await apiGet(`/${encodeURIComponent(visionId)}`);

    if (data && els.visionTitle) {
      els.visionTitle.textContent = data.title || "Без названия";
    }
    if (els.renameBtn) {
      els.renameBtn.disabled = false;
    }

    if (Array.isArray(data.steps)) {
      data.steps.forEach((step) => {
        if (step.user_text) appendMessage("user", step.user_text);
        if (step.ai_text) appendMessage("ai", step.ai_text);
      });
    }

    if (els.input) els.input.disabled = false;
    if (els.sendBtn) els.sendBtn.disabled = false;
  } catch (e) {
    console.error("[VISION] selectVision error:", e);
    setError(
      "Не удалось загрузить визию. Попробуй выбрать её ещё раз или создать новую.",
    );
  } finally {
    setLoading(false);
    renderVisionList();
  }
}

async function createNewVision() {
  setError("");
  setLoading(true);
  try {
    const data = await apiPost("/create", null);
    const v = {
      vision_id: data.vision_id,
      title: data.title,
      created_at: data.created_at,
    };
    state.visions.unshift(v);
    await selectVision(v.vision_id);
    renderVisionList();
  } catch (e) {
    console.error("[VISION] createNewVision error:", e);
    setError("Не удалось создать визию. Попробуй ещё раз.");
  } finally {
    setLoading(false);
  }
}

async function sendStep(text) {
  if (!state.currentVisionId) {
    setError("Сначала выбери визию или создай новую.");
    return;
  }

  if (!text || !text.trim()) return;

  const clean = text.trim();
  appendMessage("user", clean);
  setError("");
  setLoading(true);
  state.isSending = true;

  try {
    const data = await apiPost("/step", {
      vision_id: state.currentVisionId,
      user_text: clean,
    });

    if (data && data.ai_text) {
      appendMessage("ai", data.ai_text);
    } else {
      appendMessage("ai", "Я что-то растерялся, попробуй задать вопрос ещё раз :)");
    }
  } catch (e) {
    console.error("[VISION] sendStep error:", e);
    setError("Не удалось отправить шаг. Проверяй интернет и попробуй ещё раз.");
  } finally {
    state.isSending = false;
    setLoading(false);
  }
}

async function renameCurrentVision() {
  if (!state.currentVisionId) return;
  if (!els.visionTitle) return;

  const currentTitle = els.visionTitle.textContent || "";
  const newTitle = window.prompt("Новое название визии:", currentTitle.trim());

  if (newTitle === null) {
    return;
  }

  const clean = newTitle.trim();
  if (!clean) {
    setError("Название визии не может быть пустым.");
    return;
  }

  setError("");
  setLoading(true);

  try {
    const data = await apiPost("/rename", {
      vision_id: state.currentVisionId,
      title: clean,
    });

    const finalTitle = data && data.title ? data.title : clean;
    els.visionTitle.textContent = finalTitle;

    const idx = state.visions.findIndex(
      (v) => v.vision_id === state.currentVisionId,
    );
    if (idx !== -1) {
      state.visions[idx].title = finalTitle;
      renderVisionList();
    }
  } catch (e) {
    console.error("[VISION] renameCurrentVision error:", e);
    setError("Не удалось переименовать визию. Попробуй ещё раз.");
  } finally {
    setLoading(false);
  }
}

// ---------- init ----------

async function init() {
  els.messages = $("messages");
  els.form = $("messageForm");
  els.input = $("userInput");
  els.sendBtn = $("sendBtn");
  els.error = $("visionError");
  els.overlay = $("overlay");
  els.visionList = $("visionList");
  els.newVisionBtn = $("newVisionBtn");
  els.visionTitle = $("visionTitle");
  els.renameBtn = $("renameVisionBtn");

  setError("");

  let auth;
  try {
    auth = await waitForAuth();
  } catch (e) {
    console.error("[VISION] auth error:", e);
  }

  const isAuthenticated =
    (auth && (auth.is_authenticated ?? auth.isAuthenticated)) || false;
  const userId = auth && (auth.user_id ?? auth.userId);

  if (!isAuthenticated || !userId) {
    setError("Для работы с визиями нужно войти в систему.");
    return;
  }

  state.userId = userId;

  if (els.form && els.input) {
    els.form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!els.input || state.isSending) return;
      const text = els.input.value.trim();
      if (!text) return;
      els.input.value = "";
      sendStep(text);
    });
  }

  if (els.newVisionBtn) {
    els.newVisionBtn.addEventListener("click", () => {
      createNewVision();
    });
  }

  if (els.renameBtn) {
    els.renameBtn.addEventListener("click", () => {
      renameCurrentVision();
    });
  }

  await loadVisions();

  if (!state.visions.length) {
    await createNewVision();
  }

  console.log("[VISION] init done");
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => console.error("[VISION] init failed:", e));
});
