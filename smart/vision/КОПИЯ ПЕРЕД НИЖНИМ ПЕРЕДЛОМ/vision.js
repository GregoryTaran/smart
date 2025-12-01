// ============================================
//  SMART VISION — VISION.JS (Clean Final)
// ============================================

console.log("vision.js loaded");

// ----------------------------
// 1) USER ID из LocalStorage
// ----------------------------
const USER_ID = localStorage.getItem("sv_user_id");

if (!USER_ID) {
  alert("Ошибка: нет user_id. Авторизуйтесь заново!");
  window.location.href = "/index.html";
}

const API = "/api/vision";

// ----------------------------
// 2) Получаем ID визии из URL
// ----------------------------
const params = new URLSearchParams(window.location.search);
const VISION_ID = params.get("id");

if (!VISION_ID) {
  alert("Ошибка: нет ID визии!");
  window.location.href = "/vision/index.html";
}

// ============================================
// 3) НОРМАЛИЗАЦИЯ ТЕКСТА
// ============================================
function normalizeText(str) {
  if (!str) return "";
  return str
    .replace(/^\s+/, "")        // убираем пустые строки в начале
    .replace(/\n{3,}/g, "\n\n") // максимум один пустой абзац
    .trim();                    // убираем пустые строки в конце
}

// ============================================
// 4) ЗАГРУЗКА ВИЗИИ
// ============================================
async function loadVision() {
  try {
    const res = await fetch(`${API}/${VISION_ID}?user_id=${USER_ID}`);

    if (!res.ok) {
      alert("Ошибка доступа к визии");
      return;
    }

    const data = await res.json();
    window.VISION_DATA = data;

    renderVision(data.vision);
    renderParticipants(data.participants);
    renderSteps(data.steps);

  } catch (err) {
    console.error(err);
    alert("Ошибка загрузки визии");
  }
}

// ============================================
// 5) РЕНДЕРЫ
// ============================================

// ----- Заголовок визии -----
function renderVision(v) {
  const display = document.getElementById("vision-title-display");
  const manageInput = document.getElementById("vision-title-manage");

  const title = v.title || "";

  if (display) display.textContent = title;
  if (manageInput) manageInput.value = title;
}

// ----- Участники -----
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









// ----- Шаги (сообщения) -----
function renderSteps(steps) {
    const box = document.getElementById("steps");
    if (!box) return;

    box.innerHTML = "";

    steps.forEach(s => {
        const wrap = document.createElement("div");
        wrap.className = "step-item";

        const userText = normalizeText(s.user_text);
        const aiText   = normalizeText(s.ai_text);

        // НОВАЯ ЛОГИКА: email теперь внутри пользовательского блока
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

        wrap.innerHTML = html;
        box.appendChild(wrap);
    });

    box.scrollTop = box.scrollHeight;
}













// ============================================
// 6) ОПЕРАЦИИ (SAVE/ADD/DELETE)
// ============================================

async function renameVision() {
  const input = document.getElementById("vision-title-manage");
  if (!input) return;

  const title = input.value.trim();
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
    alert("Ошибка изменения названия визии");
  }
}

async function addParticipant() {
  const email = prompt("Введите email участника:");
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

async function addStep() {
  const input = document.getElementById("step-input");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  input.value = "";

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
      alert("Ошибка добавления шага");
      return;
    }

    await loadVision();

  } catch (err) {
    console.error(err);
    alert("Ошибка добавления шага");
  }
}

async function archiveVision() {
  if (!confirm("Отправить в архив?")) return;

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

    window.location.href = "/vision/index.html";

  } catch (err) {
    console.error(err);
    alert("Ошибка архивации визии");
  }
}

async function deleteVision() {
  if (!confirm("Удалить визию полностью?")) return;

  try {
    await fetch(`${API}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vision_id: VISION_ID,
        user_id: USER_ID
      })
    });

    window.location.href = "/vision/index.html";

  } catch (err) {
    console.error(err);
    alert("Ошибка удаления визии");
  }
}


// ============================================
// 7) ПАНЕЛЬ УПРАВЛЕНИЯ
// ============================================
function initManageToggle() {
    const btnManage = document.getElementById("toggleManage");
    const panel = document.getElementById("managePanel");
    const btnClose = document.getElementById("close-manage-btn");

    if (!btnManage || !panel) {
        console.warn("Панель управления: элементы не найдены, повтор...");
        setTimeout(initManageToggle, 100);
        return;
    }

    // по умолчанию спрятали
    panel.style.display = "none";
    panel.classList.remove("open");

    const togglePanel = (forceOpen) => {
        const isCurrentlyOpen = panel.classList.contains("open");
        const willOpen = typeof forceOpen === "boolean"
            ? forceOpen
            : !isCurrentlyOpen;

        if (willOpen) {
            // показать и запустить анимацию открытия
            panel.style.display = "block";
            // форсим перерисовку, чтобы transition сработал
            void panel.offsetHeight;
            panel.classList.add("open");
        } else {
            // запустить анимацию закрытия
            panel.classList.remove("open");
            // после окончания transition прячем из потока
            setTimeout(() => {
                panel.style.display = "none";
            }, 250); // время = как в CSS transition
        }
    };

    // кнопка "Управление"
    btnManage.addEventListener("click", () => {
        togglePanel();
    });

    // кнопка "Закрыть управление"
    if (btnClose) {
        btnClose.addEventListener("click", () => {
            togglePanel(false);
        });
    }

    console.log("Панель управления с анимацией активна");
}



// ============================================
// 8) ОБРАБОТЧИКИ КЛИКОВ
// ============================================
document.addEventListener("click", (e) => {

  if (e.target.matches("#add-participant-btn")) addParticipant();
  if (e.target.matches("#archive-btn")) archiveVision();
  if (e.target.matches("#delete-btn")) deleteVision();
  if (e.target.matches("#add-step-btn")) addStep();
  if (e.target.matches("#rename-btn")) renameVision();

});

// ============================================
// 9) ИНИЦИАЛИЗАЦИЯ
// ============================================
loadVision();
initManageToggle();
