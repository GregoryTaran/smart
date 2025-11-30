// ================================
//  SMART VISION — СПИСОК ВИЗИЙ
//  Чистый, модульный ES-module
// ================================

console.log("vision_list.js (module) loaded");

// ----------------------------
// 1) USER ID из LocalStorage
// ----------------------------
const USER_ID = localStorage.getItem("sv_user_id");

if (!USER_ID) {
    alert("Ошибка: нет user_id. Авторизуйтесь заново!");
    window.location.href = "/index.html";
}

const API = "/api/vision";


// ===============================
// 2) Загрузка списка визий
// ===============================
async function loadVisions() {
    try {
        const res = await fetch(`${API}/list?user_id=${USER_ID}`);

        if (!res.ok) {
            throw new Error("Ошибка загрузки визий");
        }

        const visions = await res.json();
        renderVisionList(visions);

    } catch (err) {
        console.error(err);
        alert("Не удалось загрузить список визий");
    }
}


// ===============================
// 3) Создание визии
// ===============================
async function createVision() {
    try {
        const res = await fetch(`${API}/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: USER_ID })
        });

        const data = await res.json();

        if (data.vision_id) {
            window.location.href = `/vision/vision.html?id=${data.vision_id}`;
        } else {
            alert("Ошибка создания визии");
        }

    } catch (err) {
        console.error(err);
        alert("Ошибка создания визии");
    }
}


// ===============================
// 4) Рендер списка
// ===============================
function renderVisionList(list) {
    const box = document.getElementById("visionList");
    box.innerHTML = "";

    if (!list || list.length === 0) {
        box.innerHTML = `<div class="empty">У вас ещё нет визий</div>`;
        return;
    }

    list.forEach(v => {
        const div = document.createElement("div");
        div.className = "vision-item";
        div.dataset.visionId = v.id;      // ← важный момент

        div.innerHTML = `
            <div class="vision-item-title">${v.title}</div>
            <div class="vision-item-date">
                ${new Date(v.created_at).toLocaleDateString()}
            </div>
            <button class="vision-btn vision-btn-primary" data-open>
                Открыть
            </button>
        `;

        box.appendChild(div);
    });
}


// ===================================================
// 5) Обработчик событий (Event Delegation)
// ===================================================
// Позволяет не создавать 1000 обработчиков
// Работает быстро и надёжно
document.addEventListener("click", (e) => {
    // Создание визии
    if (e.target.id === "newVisionBtn") {
        createVision();
        return;
    }

    // Открытие визии
    if (e.target.matches("[data-open]")) {
        const parent = e.target.closest(".vision-item");
        if (!parent) return;

        const id = parent.dataset.visionId;
        if (!id) return;

        openVision(id);
        return;
    }
});


// ===============================
// 6) Переход к визии
// ===============================
function openVision(id) {
    window.location.href = `/vision/vision.html?id=${id}`;
}


// ===============================
// 7) Инициализация
// ===============================
function init() {
    loadVisions();
}

init();
