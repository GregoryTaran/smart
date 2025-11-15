// vision/vision.js
// -----------------------------------------------------------
// Фронтовая логика модуля "Путь по визии"
// -----------------------------------------------------------
// Здесь мы:
// 1) создаём визию на сервере
// 2) отправляем шаги (сообщения) в визию
// 3) показываем диалог на странице
// 4) храним vision_id в URL (#vision=...), чтобы не потерять
//    контекст при перезагрузке страницы
// -----------------------------------------------------------

const API_BASE = "/api/vision";

// Глобальное состояние фронта (микро-стор)
const state = {
  userId: null,        // кто пишет (берём из svid / localStorage)
  visionId: null,      // текущая визия (UUID с сервера)
  isCreating: false,   // флаг "создаём визию"
  isSending: false,    // флаг "отправляем шаг"
};

// ---------------------------------------------
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ---------------------------------------------

// Короткий хелпер вместо document.querySelector
function qs(sel) {
  return document.querySelector(sel);
}

// Показ / скрытие блока ошибок
function showError(msg) {
  const box = qs("#visionError");
  if (!box) {
    console.warn("[VISION] #visionError не найден в DOM");
    return;
  }
  box.textContent = msg || "";
  box.classList.toggle("hidden", !msg);
}

// Добавляем сообщение в список диалога
// role: "user" | "ai"
// text: строка
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
  list.scrollTop = list.scrollHeight; // скроллим вниз
}

// Простейший escape, чтобы не ломать HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Включение / выключение формы отправки сообщений
function setFormEnabled(enabled) {
  const input = qs("#userInput");
  const btn = qs("#sendBtn");

  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled;

  if (enabled && input) {
    input.focus();
  }
}

// ---------------------------------------------
// РАБОТА С URL (hash) ДЛЯ vision_id
// ---------------------------------------------
//
// Мы хотим, чтобы при создании визии её id попадал в URL,
// например:
//   https://.../vision.html#vision=UUID
//
// Тогда если страница перезагрузится,
// мы сможем прочитать этот id и продолжить ту же визию.
//

// Читаем vision_id из hash, если он там есть
// Формат ожидаем такой: #vision=<id>
// Возвращаем строку id или null.
function getVisionIdFromHash() {
  try {
    const hash = window.location.hash || "";
    // пример hash: "#vision=123e4567-..."
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

// Записываем vision_id в hash, чтобы можно было восстановить
// позже. Страница при этом НЕ перезагружается.
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

// ---------------------------------------------
// USER ID (svid / локальный)
// ---------------------------------------------
//
// Здесь мы пытаемся аккуратно вытащить user_id.
// Идея:
// 1) Пытаемся прочитать его из svid (если он уже интегрирован).
// 2) Если не получилось — берём из localStorage (чтобы был стабильный).
// 3) Если и там нет — генерируем локальный и сохраняем.
//

// Пытаемся эвристически вытащить user_id из SVID.
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

// Генератор локального ID, если ничего другого нет
function makeLocalUserId() {
  return "local-" + Math.random().toString(36).slice(2);
}

// Гарантируем, что state.userId заполнен
async function ensureUserId() {
  if (state.userId) {
    console.log("[VISION] userId уже есть:", state.userId);
    return state.userId;
  }

  // 1) Пытаемся взять из SVID
  const fromSvid = detectUserIdFromSvid();
  if (fromSvid) {
    state.userId = fromSvid;
    console.log("[VISION] userId из SVID:", state.userId);
    return state.userId;
  }

  // 2) Пытаемся взять из localStorage
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

  // 3) Если ничего нет — генерируем новый локальный
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

// ---------------------------------------------
// API: СОЗДАНИЕ ВИЗИИ
// ---------------------------------------------

async function createVision() {
  showError("");

  if (state.isCreating) {
    console.log("[VISION] уже создаём визию, ждём...");
    return;
  }

  try {
    state.isCreating = true;

    // Убеждаемся, что userId есть
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

    // Кладём vision_id в URL, чтобы можно было восстановить при перезагрузке
    setVisionIdInHash(state.visionId);

    // Показываем блок с текущей визией
    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    if (info) info.classList.remove("vision-hidden");
    if (title) {
      title.textContent = data.title || `Визия ${state.visionId}`;
    }

    // Включаем форму, чтобы можно было писать шаги
    setFormEnabled(true);
  } catch (err) {
    console.error(err);
    showError("Не удалось создать визию. Проверь сервер.");
  } finally {
    state.isCreating = false;
  }
}

// ---------------------------------------------
// API: ОТПРАВКА ШАГА В ВИЗИЮ
// ---------------------------------------------

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

  // Пишем сообщение на фронте сразу (опыт как в мессенджере)
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

// ---------------------------------------------
// ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ
// ---------------------------------------------
//
// Здесь мы:
// 1) Находим нужные элементы в DOM.
// 2) Пытаемся восстановить vision_id из URL (#vision=...).
// 3) Настраиваем кнопку "Создать визию" и форму отправки.
// ---------------------------------------------

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

  // 1) Пытаемся восстановить уже существующую визию из URL:
  //    если в адресе есть #vision=<id>, считаем, что визия уже создана.
  //    Делаем это БЕЗОПАСНО: если вдруг функции getVisionIdFromHash нет,
  //    init не падает, а просто считает, что хеша нет.
  let existingVisionId = null;
  try {
    if (typeof getVisionIdFromHash === "function") {
      existingVisionId = getVisionIdFromHash();
    } else {
      console.log("[VISION] getVisionIdFromHash не определён, пропускаем hash");
    }
  } catch (e) {
    console.error("[VISION] safe hash read error", e);
  }

  if (existingVisionId) {
    state.visionId = existingVisionId;
    console.log("[VISION] restored visionId from URL:", state.visionId);

    // Включаем форму, как будто визия уже была создана до перезагрузки
    setFormEnabled(true);

    const info = qs("#visionInfo");
    const title = qs("#visionTitle");
    if (info) info.classList.remove("vision-hidden");
    if (title) {
      // Точного title от сервера сейчас нет, поэтому временно техническое имя
      title.textContent = `Визия ${existingVisionId}`;
    }
  } else {
    // Визия ещё не создана — блокируем форму до нажатия на кнопку
    setFormEnabled(false);
  }

  // 2) Кнопка "Создать визию"
  createBtn.addEventListener("click", (e) => {
    e.preventDefault();
    createVision();
  });

  // 3) Отправка шага (форма)
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendStep(text);
  });

  // 4) Параллельно пытаемся получить userId (svid / localStorage)
  ensureUserId().catch((e) =>
    console.error("[VISION] ensureUserId on init failed:", e),
  );

  console.log("[VISION] init done");
}

// Запускаем init, когда DOM готов
document.addEventListener("DOMContentLoaded", init);
