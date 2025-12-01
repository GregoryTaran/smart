// ============================================
//  SMART VISION — VISION.JS (updated)
// ============================================

console.log("vision.js (module) loaded");

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
// 3) ЗАГРУЗКА ВИЗИИ
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
// 4) РЕНДЕРЫ
// ============================================
function renderVision(v) {
    const display = document.getElementById("vision-title-display");
    const manageInput = document.getElementById("vision-title-manage");

    const title = v.title || "";

    if (display) {
        display.textContent = title;
    }
    if (manageInput) {
        manageInput.value = title;
    }
}

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

function renderSteps(steps) {
    const box = document.getElementById("steps");
    if (!box) return;

    box.innerHTML = "";

    steps.forEach(s => {
        const wrap = document.createElement("div");
        wrap.className = "step-item";

        const userHTML = `
            <div class="step-block user">
                <div class="step-block-inner">
                    ${s.user_text}
                </div>
            </div>
        `;

        const aiHTML = s.ai_text ? `
            <div class="step-block ai">
                <div class="step-block-inner">
                    ${s.ai_text}
                </div>
            </div>
        ` : "";

        wrap.innerHTML = `
            <div class="step-author">${s.user_name}</div>
            ${userHTML}
            ${aiHTML}
        `;

        box.appendChild(wrap);
    });

    box.scrollTop = box.scrollHeight;
}



// ============================================
// 5) ОПЕРАЦИИ (SAVE/ADD/DELETE)
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

        // обновить отображение
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
// 6) ПАНЕЛЬ УПРАВЛЕНИЯ (toggle + закрыть)
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

    panel.style.display = "none";

    // Открыть / закрыть по кнопке "Управление"
    btnManage.addEventListener("click", () => {
        panel.style.display =
            (panel.style.display === "none") ? "block" : "none";
    });

    // Кнопка "Закрыть управление" внутри панели
    if (btnClose) {
        btnClose.addEventListener("click", () => {
            panel.style.display = "none";
        });
    }

    console.log("Панель управления активна");
}


// ============================================
// 7) ОБРАБОТЧИКИ КЛИКОВ (кнопки внутри страницы)
// ============================================
document.addEventListener("click", (e) => {

    if (e.target.matches("#add-participant-btn")) {
        addParticipant();
    }

    if (e.target.matches("#archive-btn")) {
        archiveVision();
    }

    if (e.target.matches("#delete-btn")) {
        deleteVision();
    }

    if (e.target.matches("#add-step-btn")) {
        addStep();
    }

    if (e.target.matches("#rename-btn")) {
        renameVision();
    }
});


// ============================================
// 8) ИНИЦИАЛИЗАЦИЯ
// ============================================
loadVision();
initManageToggle();
