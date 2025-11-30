console.log("vision_list.js loaded");

document.addEventListener("SMART_SESSION_READY", () => {
    initVisionList();
});

const API = "/api/vision";

/**
 * Загружаем список визий пользователя
 */
async function loadVisions() {
    try {
        const url = `${API}/list?user_id=${USER_ID}`;
        const res = await fetch(url);

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

/**
 * Создать новую визию
 */
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

/**
 * Рендер списка визий
 */
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

        div.innerHTML = `
            <div class="vision-item-title">${v.title}</div>
            <div class="vision-item-date">${new Date(v.created_at).toLocaleDateString()}</div>
            <button class="vision-btn vision-btn-primary" onclick="openVision('${v.id}')">
                Открыть
            </button>
        `;

        box.appendChild(div);
    });
}

/**
 * Переход к визии
 */
function openVision(id) {
    window.location.href = `/vision/vision.html?id=${id}`;
}


function initVisionList() {
    const USER_ID = window.SMART_SESSION.user_id;

    document.getElementById("newVisionBtn")
        .addEventListener("click", createVision);

    loadVisions();
}
