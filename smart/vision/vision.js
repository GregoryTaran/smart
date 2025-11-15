// vision/vision.js
// -----------------------------------------------------------
// Фронтовая логика модуля "Путь по визии"
// -----------------------------------------------------------

const API_BASE = "/api/vision";

const state = {
  userId: null,
  visionId: null,
  isCreating: false,
  isSending: false,
};

// ---------- хелперы DOM / UI ----------

function qs(sel) {
  return document.querySelector(sel);
}

function showError(msg) {
  const box = qs("#visionError");
  if (!box) {
    console.warn("[VISION] #visionError не найден в DOM");
    return;
  }
  box.textContent = msg || "";
  box.classList.toggle("hidden", !msg);
}

function appendMessage(role, text) {
  const list = qs("#messages");
  if (!list) {
    console.warn("[VISION] #messages не найден в DOM");
    return;
  }

  const item = document.createElement("div");
  item.className = `vision-message vision-message--${role}`;

  const label = role === "user" ? "Ты" : "Система";

  item.innerHTML = `
    <div class="vision-message-label">${label}</div>
    <div class="vision-message-text">${escapeHtml(text)}</div>
  `.trim();

  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setFormEnabled(enabled) {
  const input = qs("#userInput");
  const btn = qs("#sendBtn");

  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled;

  if (enabled && input) {
    input.focus();
  }
}

// ---------- hash / URL (vision_id в адресной строке) ----------

function getVisionIdFromHash() {
  try {
    const hash = window.location.hash || "";
    const m = hash.match(/vision=([^&]+)/);
    if (m && m[1]) {
      const visionId = decodeURIComponent(m[1]);
      console.log("[VISION] getVisionIdFromHash:", visionId);
      return visionId;
    }
  } catch (e) {
    console.error("[VISION] getVisionIdFromHash error:", e);
  }
  return null;
}

function setVisionIdInHash(visionId) {
  try {
    if (!visionId) return;
    const base = window.location.href.split("#")[0];
    const newUrl = `${base}#vision=${encodeURIComponent(visionId)}`;
    window.history.replaceState(null, "", newUrl);
    console.log("[VISION] setVisionIdInHash:", newUrl);
  } catch (e) {
    console.error("[VISION] setVisionIdInHash error:", e);
  }
}

// ---------- user_id (svid / localStorage / локальный) ----------

function detectUserIdFromSvid() {
  try {
    if (window.svidUserId && typeof window.svidUserId === "string") {
      return window.svidUserId;
    }
    if (window.SVID_USER_ID && typeof window.SVID_USER_ID === "string") {
      return window.SVID_USER_ID;
    }
    if (window.svid && typeof window.svid.userId === "string") {
      return window.svid.userId;
    }
    if (
      window.svid &&
      window.svid.user &&
      typeof window.svid.user.id === "string"
    ) {
      return window.svid.user.id;
    }
  } catch (e) {
    console.error("[VISION] detectUserIdFromSvid error:", e);
  }

  return null;
}

function makeLocalUserId() {
  return "local-" + Math.random().toString(36).slice(2);
}

async function ensureUserId() {
  if (state.userId) {
    console.log("[VISION] userId уже есть:", state.userId);
    return state.userId;
  }

  const fromSvid = detectUserIdFromSvid();
  if (fromSvid) {
    state.userId = fromSvid;
    console.log("[VISION] userId из SVID:", state.userId);
    return state.userId;
  }

  try {
    const stored = window.localStorage.getItem("vision_user_id");
    if (stored) {
      state.userId = stored;
      console.log("[VISION] userId из localStorage:", state.userId);
      return state.userId;
    }
  } catch (e) {
    console.warn("[VISION] не удалось прочитать localStorage:", e);
  }

  const localId = makeLocalUserId();
  state.userId = localId;
  console.log("[VISION] сгенерировали новый локальный userId:", state.userId);

  try {
    window.localStorage.setItem("vision_user_id", state.userId);
  } catch (e) {
    console.warn("[VISION] не удалось записать в localStorage:", e);
  }

  return state.userId;
}

// ---------- API: создание визии ----------

async function createVision() {
  showError("");

  if (state.isCreating) {
    console.log("[VISION] уже создаём визию, ждём...");
    return;
  }

  try {
    state.isCreating = true;

    const userId = await ensureUserId();
    console.log("[VISION] createVision -> user_id =", userId);

    const res = await fetch(`${API_BASE}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[VISION] createVision error:", res.status, text);
      throw new Error("Ошибка создания визии");
    }

    const data = await res.json();
    state.visionId = data.vision_id;
    console.log("[VISION] vision created:", data);

    setVisionIdInHash(state.visionId);

    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    if (info) info.classList.remove("vision-hidden");
    if (title) {
      title.textContent = data.title || `Визия ${state.visionId}`;
    }

    setFormEnabled(true);
  } catch (err) {
    console.error(err);
    showError("Не удалось создать визию. Проверь сервер.");
  } finally {
    state.isCreating = false;
  }
}

// ---------- API: шаг визии ----------

async function sendStep(userText) {
  showError("");

  if (!state.visionId) {
    showError("Сначала создай визию.");
    return;
  }

  if (state.isSending) {
    console.log("[VISION] шаг уже отправляется, подожди...");
    return;
  }

  appendMessage("user", userText);

  try {
    state.isSending = true;

    const res = await fetch(`${API_BASE}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: state.visionId,
        user_text: userText,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[VISION] step error:", res.status, text);
      throw new Error("Ошибка шага визии");
    }

    const data = await res.json();
    console.log("[VISION] step response:", data);

    appendMessage("ai", data.ai_text || "(пустой ответ)");
  } catch (err) {
    console.error("[VISION] sendStep exception:", err);
    showError("Ошибка при запросе к ИИ. Смотри логи сервера.");
  } finally {
    state.isSending = false;
  }
}

// ---------- API: загрузка визии и её истории ----------
//
// Вызывается при заходе по ссылке с #vision=<id>,
// чтобы подтянуть все старые шаги и показать "дом".

async function loadVision(visionId) {
  showError("");
  console.log("[VISION] loadVision:", visionId);

  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(visionId)}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[VISION] loadVision error:", res.status, text);
      showError("Не удалось загрузить визию. Но можно продолжать писать.");
      return;
    }

    const data = await res.json();
    console.log("[VISION] loadVision data:", data);

    state.visionId = data.vision_id;

    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    if (info) info.classList.remove("vision-hidden");
    if (title) {
      title.textContent = data.title || `Визия ${data.vision_id}`;
    }

    const messagesContainer = qs("#messages");
    if (messagesContainer) {
      messagesContainer.innerHTML = "";
    }

    if (Array.isArray(data.steps)) {
      for (const step of data.steps) {
        if (step.user_text) {
          appendMessage("user", step.user_text);
        }
        if (step.ai_text) {
          appendMessage("ai", step.ai_text);
        }
      }
    }
  } catch (e) {
    console.error("[VISION] loadVision exception:", e);
    showError("Ошибка при загрузке визии. Смотри консоль.");
  }
}

// ---------- init ----------

function init() {
  console.log("[VISION] init start");

  const createBtn = qs("#createVisionBtn");
  const form = qs("#messageForm");
  const input = qs("#userInput");
  const sendBtn = qs("#sendBtn");

  if (!createBtn || !form || !input || !sendBtn) {
    console.error("[VISION] Не нашёл нужные элементы в DOM");
    return;
  }

  let existingVisionId = null;
  try {
    if (typeof getVisionIdFromHash === "function") {
      existingVisionId = getVisionIdFromHash();
    }
  } catch (e) {
    console.error("[VISION] safe hash read error", e);
  }

  if (existingVisionId) {
    console.log("[VISION] restoring vision from URL:", existingVisionId);
    setFormEnabled(true);

    // временный титул, пока грузим с сервера
    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    if (info) info.classList.remove("vision-hidden");
    if (title) {
      title.textContent = `Визия ${existingVisionId} (загрузка...)`;
    }

    loadVision(existingVisionId);
  } else {
    setFormEnabled(false);
  }

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

  ensureUserId().catch((e) =>
    console.error("[VISION] ensureUserId on init failed:", e),
  );

  console.log("[VISION] init done");
}

document.addEventListener("DOMContentLoaded", init);
