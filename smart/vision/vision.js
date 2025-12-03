// =======================================================
//  SMART VISION — VISION PAGE (Restored Full Version)
// =======================================================

console.log("vision.js loaded");

// -------------------------------------------------------
// 1. USER ID
// -------------------------------------------------------
const USER_ID = localStorage.getItem("sv_user_id");
if (!USER_ID) {
  alert("Ошибка: нет user_id! Авторизуйтесь заново.");
  window.location.href = "/index.html";
}

const API = "/api/vision";

// -------------------------------------------------------
// 2. Получаем ID визии
// -------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const VISION_ID = params.get("id");

if (!VISION_ID) {
  alert("Ошибка: нет ID визии");
  window.location.href = "/vision/vision_list.html";
}

// -------------------------------------------------------
// 3. DOM элементы
// -------------------------------------------------------
const elTitleDisplay = document.getElementById("vision-title-display");
const elTitleManage = document.getElementById("vision-title-manage");
const elDate = document.getElementById("visionDate");
const elParts = document.getElementById("visionParticipants");
const elSteps = document.getElementById("steps");

const elInput = document.getElementById("step-input");
const elAddBtn = document.getElementById("add-step-btn");

const managePanel = document.getElementById("managePanel");
const btnToggleManage = document.getElementById("toggleManage");
const btnCloseManage = document.getElementById("close-manage-btn");

const btnRename = document.getElementById("rename-btn");
const btnAddParticipant = document.getElementById("add-participant-btn");
const btnArchive = document.getElementById("archive-btn");
const btnDelete = document.getElementById("delete-btn");

// -------------------------------------------------------
// 4. Утилита нормализации текста
// -------------------------------------------------------
function cleanText(str) {
  if (!str) return "";
  return str
    .replace(/^\s+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// -------------------------------------------------------
// 5. Загрузить визию
// -------------------------------------------------------
async function loadVision() {
  try {
    const res = await fetch(`${API}/${VISION_ID}?user_id=${USER_ID}`);
    if (!res.ok) {
      alert("Ошибка загрузки визии");
      return;
    }

    const data = await res.json();
    renderHeader(data.vision, data.participants);
    renderParticipants(data.participants);
    renderSteps(data.steps);

  } catch (err) {
    console.error(err);
    alert("Ошибка загрузки визии");
  }
}

// -------------------------------------------------------
// 6. Рендер заголовка и метаданных
// -------------------------------------------------------
function renderHeader(v, parts) {
  if (elTitleDisplay) elTitleDisplay.textContent = v.title || "Без названия";
  if (elTitleManage) elTitleManage.value = v.title || "";

  // дата
  if (elDate) {
    const created = v.created_at
      ? new Date(v.created_at).toLocaleDateString("ru-RU")
      : "";
    elDate.textContent = created;
  }

  // участники короткой строкой
  if (elParts) {
    const names = parts
      .filter(p => p.role !== "ai")
      .map(p => p.name || p.email);

    elParts.textContent = names.length
      ? "Участники: " + names.join(", ")
      : "";
  }
}

// -------------------------------------------------------
// 7. Рендер участников (в managePanel)
// -------------------------------------------------------
function renderParticipants(parts) {
  const box = document.getElementById("participants");
  if (!box) return;

  box.innerHTML = "";

  parts.forEach(p => {
    const div = document.createElement("div");
    div.className = "participant-item";
    div.innerHTML = `
      <div class="participant-name">${p.name || p.email}</div>
      <div class="participant-role">${p.role}</div>
    `;
    box.appendChild(div);
  });
}

// -------------------------------------------------------
// 8. Рендер шагов (user + ai)
// -------------------------------------------------------
function renderSteps(steps) {
  if (!elSteps) return;
  elSteps.innerHTML = "";

  steps.forEach(s => {
    const wrapper = document.createElement("div");
    wrapper.className = "step-item";

    const userText = cleanText(s.user_text);
    const aiText = cleanText(s.ai_text);

    let html = `
      <div class="msg-block user">
        <div class="msg-author">${s.user_name}</div>
        <div class="msg-inner">${userText}</div>
      </div>
    `;

    if (aiText) {
      html += `
        <div class="msg-block ai">
          <div class="msg-inner">${aiText}</div>
        </div>
      `;
    }

    wrapper.innerHTML = html;
    elSteps.appendChild(wrapper);
  });

  // автоскролл вниз
  elSteps.scrollTop = elSteps.scrollHeight;
}

// -------------------------------------------------------
// 9. Добавить шаг
// -------------------------------------------------------
async function addStep() {
  const text = elInput.value.trim();
  if (!text) return;

  elInput.value = "";
  elAddBtn.disabled = true;

  const body = {
    vision_id: VISION_ID,
    user_id: USER_ID,
    user_text: text,
    with_ai: true
  };

  try {
    const res = await fetch(`${API}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      alert("Ошибка отправки шага");
      elAddBtn.disabled = false;
      return;
    }

    await loadVision();
    elAddBtn.disabled = false;

  } catch (err) {
    console.error(err);
    alert("Ошибка добавления шага");
    elAddBtn.disabled = false;
  }
}

// -------------------------------------------------------
// 10. Переименовать визию
// -------------------------------------------------------
async function renameVision() {
  const title = elTitleManage.value.trim();
  if (!title) return;

  try {
    await fetch(`${API}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: VISION_ID,
        user_id: USER_ID,
        title
      })
    });

    await loadVision();

  } catch (err) {
    console.error(err);
    alert("Ошибка переименования");
  }
}

// -------------------------------------------------------
// 11. Добавить участника
// -------------------------------------------------------
async function addParticipant() {
  const email = prompt("Email участника:");
  if (!email) return;

  try {
    const res = await fetch(`${API}/add_participant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: VISION_ID,
        user_id: USER_ID,
        email
      })
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.detail || "Ошибка добавления участника");
      return;
    }

    await loadVision();

  } catch (err) {
    console.error(err);
    alert("Ошибка добавления участника");
  }
}

// -------------------------------------------------------
// 12. Архивация
// -------------------------------------------------------
async function archiveVision() {
  if (!confirm("Перенести визию в архив?")) return;

  try {
    await fetch(`${API}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: VISION_ID,
        user_id: USER_ID,
        archived: true
      })
    });

    window.location.href = "/vision/vision_list.html";

  } catch (err) {
    console.error(err);
    alert("Ошибка архивации");
  }
}

// -------------------------------------------------------
// 13. Удаление
// -------------------------------------------------------
async function deleteVision() {
  if (!confirm("Удалить визию навсегда?")) return;

  try {
    await fetch(`${API}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: VISION_ID,
        user_id: USER_ID
      })
    });

    window.location.href = "/vision/vision_list.html";

  } catch (err) {
    console.error(err);
    alert("Ошибка удаления визии");
  }
}

// -------------------------------------------------------
// 14. Управление panel (открытие / закрытие)
// -------------------------------------------------------
function initManagePanel() {
  if (!btnToggleManage || !managePanel) return;

  // спрятать по умолчанию
  managePanel.style.display = "none";

  const toggle = (open) => {
    const isOpen = managePanel.classList.contains("open");
    const willOpen = open !== undefined ? open : !isOpen;

    if (willOpen) {
      managePanel.style.display = "block";
      void managePanel.offsetHeight;
      managePanel.classList.add("open");
    } else {
      managePanel.classList.remove("open");
      setTimeout(() => {
        managePanel.style.display = "none";
      }, 250);
    }
  };

  btnToggleManage.addEventListener("click", () => toggle());
  if (btnCloseManage) btnCloseManage.addEventListener("click", () => toggle(false));
}

// -------------------------------------------------------
// 15. Слушатели
// -------------------------------------------------------
elAddBtn.addEventListener("click", addStep);

elInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    addStep();
  }
});

btnRename.addEventListener("click", renameVision);
btnAddParticipant.addEventListener("click", addParticipant);
btnArchive.addEventListener("click", archiveVision);
btnDelete.addEventListener("click", deleteVision);

// -------------------------------------------------------
// 16. Старт
// -------------------------------------------------------
initManagePanel();
loadVision();
