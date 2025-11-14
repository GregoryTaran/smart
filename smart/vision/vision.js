// vision/vision.js

const API_BASE = "/api/vision";

const state = {
  userId: null,
  visionId: null,
};

// ---------- SVID / user_id ----------

function makeLocalFallbackUserId() {
  const key = "vision.local_user_id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = "local-" + Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
    return id;
  } catch (e) {
    console.error("[VISION] localStorage fallback user_id error", e);
    return "local-" + Math.random().toString(36).slice(2);
  }
}

async function resolveUserIdFromSVID() {
  try {
    if (window.SVID) {
      // даём SVID шанс инициализироваться
      if (typeof window.SVID.ensureVisitorAndLevel === "function") {
        await window.SVID.ensureVisitorAndLevel();
      } else if (window.SVID.ready && typeof window.SVID.ready.then === "function") {
        await window.SVID.ready;
      }

      if (typeof window.SVID.getState === "function") {
        const snap = window.SVID.getState();
        if (snap) {
          if (snap.user_id) return snap.user_id;       // залогиненный юзер
          if (snap.visitor_id) return snap.visitor_id; // хотя бы визитор
        }
      }
    }

    // прямое чтение по контракту
    if (typeof localStorage !== "undefined") {
      const lsUser = localStorage.getItem("svid.user_id");
      if (lsUser) return lsUser;
      const lsVisitor = localStorage.getItem("svid.visitor_id");
      if (lsVisitor) return lsVisitor;
    }
  } catch (e) {
    console.error("[VISION] error while getting user_id from SVID", e);
  }

  // если SVID ещё не завезён — дев-фоллбек
  return makeLocalFallbackUserId();
}

async function ensureUserId() {
  if (state.userId) return state.userId;
  state.userId = await resolveUserIdFromSVID();
  console.log("[VISION] user_id =", state.userId);
  return state.userId;
}

// ---------- DOM helpers ----------

function qs(sel) {
  return document.querySelector(sel);
}

function showError(msg) {
  const box = qs("#visionError");
  if (!box) return;
  if (!msg) {
    box.textContent = "";
    box.classList.add("vision-hidden");
  } else {
    box.textContent = msg;
    box.classList.remove("vision-hidden");
  }
}

function setFormEnabled(enabled) {
  const input = qs("#userInput");
  const btn = qs("#sendBtn");
  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled;
}

function clearMessages() {
  const list = qs("#messages");
  if (!list) return;
  list.innerHTML = "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendMessage(role, text) {
  const list = qs("#messages");
  if (!list) return;

  const item = document.createElement("div");
  const kind = role === "user" ? "user" : "ai";
  item.className = `vision-message vision-message--${kind}`;

  const label = role === "user" ? "Ты" : "Визион-бот";

  item.innerHTML = `
    <div class="vision-message-label">${escapeHtml(label)}</div>
    <div class="vision-message-text">${escapeHtml(text)}</div>
  `;

  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

// ---------- API calls ----------

async function createVision() {
  showError("");
  const btn = qs("#createVisionBtn");

  try {
    if (btn) btn.disabled = true;
    setFormEnabled(false);
    clearMessages();

    const userId = await ensureUserId();

    const res = await fetch(`${API_BASE}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });

    if (!res.ok) {
      let raw = "";
      try {
        raw = await res.text();
      } catch (_) {}
      console.error("[VISION] createVision error:", res.status, raw);
      throw new Error("createVision failed");
    }

    const data = await res.json();
    state.visionId = data.vision_id;
    console.log("[VISION] vision created:", data);

    // 👉 вот тут магия с именем визии
    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    if (info) info.classList.remove("vision-hidden");
    if (title) title.textContent = data.title || `Визия ${data.vision_id}`;

    setFormEnabled(true);
    const input = qs("#userInput");
    if (input) input.focus();
  } catch (err) {
    console.error("[VISION] createVision exception:", err);
    showError("Не удалось создать визию. Проверь сервер.");
  } finally {
    if (btn) btn.disabled = false;
  }
}


async function sendStep(userText) {
  showError("");
  if (!state.visionId) {
    showError("Сначала создай визию.");
    return;
  }

  appendMessage("user", userText);

  const input = qs("#userInput");
  const btn = qs("#sendBtn");

  try {
    if (input) input.disabled = true;
    if (btn) btn.disabled = true;

    const res = await fetch(`${API_BASE}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: state.visionId,
        user_text: userText,
      }),
    });

    if (!res.ok) {
      let raw = "";
      try {
        raw = await res.text();
      } catch (_) {}
      console.error("[VISION] step error:", res.status, raw);
      throw new Error("Ошибка шага визии");
    }

    const data = await res.json();
    appendMessage("ai", data.ai_text || "Пустой ответ визион-бота 🤔");
  } catch (err) {
    console.error("[VISION] sendStep exception:", err);
    showError("Что-то пошло не так при обработке шага визии.");
  } finally {
    if (input) input.disabled = false;
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

// ---------- init ----------

function init() {
  const createBtn = qs("#createVisionBtn");
  const form = qs("#messageForm");
  const input = qs("#userInput");
  const sendBtn = qs("#sendBtn");

  if (!createBtn || !form || !input || !sendBtn) {
    console.error("[VISION] Не нашёл нужные элементы в DOM");
    return;
  }

  // изначально форма недоступна, пока не создадим визию
  setFormEnabled(false);

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

  // не обязательно, но можно заранее разбудить SVID
  ensureUserId().catch((e) =>
    console.error("[VISION] ensureUserId on init failed:", e),
  );
}

document.addEventListener("DOMContentLoaded", init);
