// ============================================
//  SMART VISION — СПИСОК ВИЗИЙ (updated)
// ============================================

console.log("vision_list.js (updated) loaded");

const USER_ID = localStorage.getItem("sv_user_id");

if (!USER_ID) {
    alert("Ошибка: нет user_id. Авторизуйтесь заново!");
    window.location.href = "/index.html";
}

const API = "/api/vision";


// --------------------------------------------------
// Генерация красивого дефолтного названия
// --------------------------------------------------
function generateVisionTitle() {
    const now = new Date();

    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(2);

    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");

    return `Визия от ${dd}.${mm}.${yy} / ${hh}:${min}`;
}


// --------------------------------------------------
// 1) Загрузка списка визий
// --------------------------------------------------
async function loadVisions() {
    try {
        const res = await fetch(`${API}/list?user_id=${USER_ID}`);

        if (!res.ok) throw new Error("Ошибка загрузки визий");

        const visions = await res.json();
        renderVisionList(visions);

    } catch (err) {
        console.error(err);
        alert("Не удалось загрузить список визий");
    }
}


// --------------------------------------------------
// 2) Создание новой визии с дефолтным именем
// --------------------------------------------------
async function createVision() {
    try {
        const res = await fetch(`${API}/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: USER_ID })
        });

        const data = await res.json();
        if (!data.vision_id) {
            alert("Ошибка создания визии");
            return;
        }

        // === Создаём красивое имя ===
        const title = generateVisionTitle();

        await fetch(`${API}/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                vision_id: data.vision_id,
                user_id: USER_ID,
                title
            })
        });

        window.location.href = `/vision/vision.html?id=${data.vision_id}`;

    } catch (err) {
        console.error(err);
        alert("Ошибка создания визии");
    }
}


// --------------------------------------------------
// 3) Рендер списка
// --------------------------------------------------
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
        div.dataset.visionId = v.id;

        div.innerHTML = `
            <div class="vision-item-title">${v.title}</div>
            <div class="vision-item-date">${new Date(v.created_at).toLocaleDateString()}</div>
            <button class="vision-btn vision-btn-primary" data-open>Открыть</button>
        `;

        box.appendChild(div);
    });
}


// --------------------------------------------------
// 4) События
// --------------------------------------------------
document.addEventListener("click", (e) => {

    if (e.target.id === "newVisionBtn") {
        createVision();
        return;
    }

    if (e.target.matches("[data-open]")) {
        const parent = e.target.closest(".vision-item");
        if (!parent) return;

        const id = parent.dataset.visionId;
        if (!id) return;

        openVision(id);
    }
});


// --------------------------------------------------
// 5) Переход к визии
// --------------------------------------------------
function openVision(id) {
    window.location.href = `/vision/vision.html?id=${id}`;
}


// --------------------------------------------------
// 6) Инициализация
// --------------------------------------------------
loadVisions();
