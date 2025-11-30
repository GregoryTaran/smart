console.log("vision.js loaded");

// МГНОВЕННО берём user_id из localStorage
const USER_ID = localStorage.getItem("sv_user_id");

if (!USER_ID) {
    alert("Ошибка: нет user_id. Авторизуйтесь заново!");
    window.location.href = "/index.html";
}

// Берём ID визии из URL
const urlParams = new URLSearchParams(window.location.search);
const VISION_ID = urlParams.get("id");

if (!VISION_ID) alert("Ошибка: нет ID визии!");

const API = "/api/vision";

/**
 * ЗАГРУЗКА ПОЛНОЙ ВИЗИИ
 */
export async function loadVision() {
    try {
        const res = await fetch(`${API}/${VISION_ID}?user_id=${USER_ID}`);

        if (!res.ok) {
            alert("Ошибка доступа к визии");
            return;
        }

        const data = await res.json();
        window.VISION_DATA = data;

        renderVision(data.vision);
        renderSteps(data.steps);
        renderParticipants(data.participants);

    } catch (err) {
        console.error(err);
        alert("Ошибка загрузки визии");
    }
}

/**
 * Рендер заголовка визии
 */
function renderVision(v) {
    const titleEl = document.getElementById("vision-title");
    titleEl.value = v.title || "";
}

/**
 * Рендер шагов
 */
function renderSteps(steps) {
    const box = document.getElementById("steps");
    box.innerHTML = "";

    steps.forEach(s => {
        const wrap = document.createElement("div");
        wrap.className = "step-item";

        wrap.innerHTML = `
            <div class="step-author">${s.user_name || "???"}</div>
            <div class="step-user-text">${s.user_text}</div>
            ${s.ai_text ? `<div class="step-ai-text">${s.ai_text}</div>` : ""}
        `;

        box.appendChild(wrap);
    });

    box.scrollTop = box.scrollHeight;
}

/**
 * Рендер участников
 */
function renderParticipants(parts) {
    const box = document.getElementById("participants");
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

/**
 * Добавление шага
 */
export async function addStep() {
    const input = document.getElementById("step-input");
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

/**
 * Добавление участника
 */
export async function addParticipant() {
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
            const e = await res.json();
            alert(e.detail || "Ошибка добавления участника");
            return;
        }

        await loadVision();

    } catch (err) {
        console.error(err);
        alert("Ошибка добавления участника");
    }
}

/**
 * Переименование визии
 */
export async function renameVision() {
    const title = document.getElementById("vision-title").value.trim();

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

    } catch (err) {
        console.error(err);
        alert("Ошибка изменения названия визии");
    }
}

/**
 * Архивация визии
 */
export async function archiveVision() {
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

/**
 * Удаление визии
 */
export async function deleteVision() {
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

// ИНИЦИАЛИЗАЦИЯ
loadVision();
