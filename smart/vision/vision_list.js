/* ==========================================================
   SMART VISION — СПИСОК ВИЗИЙ
   Финальная стабильная версия
   Работает после полной загрузки: window.onload
   by БРО ❤️🔥
========================================================== */

console.log("vision_list.js loaded (FINAL)");

window.addEventListener("load", () => {
  console.log("window.onload → DOM + init.js + topbar готово");

  /* --------------------------------------------------------
     1. USER ID
  -------------------------------------------------------- */
  const USER_ID = localStorage.getItem("sv_user_id");

  if (!USER_ID) {
    alert("Ошибка входа: нет user_id");
    window.location.href = "/index.html";
    return;
  }

  console.log("USER_ID =", USER_ID);


  /* --------------------------------------------------------
     2. DOM элементы
  -------------------------------------------------------- */
  const listContainer = document.getElementById("visionList");
  const createBtn = document.getElementById("createVisionBtn");

  if (!listContainer) {
    console.error("❌ visionList НЕ НАЙДЕН!");
    return;
  }

  console.log("visionList найден → OK");


  /* --------------------------------------------------------
     3. API URL
  -------------------------------------------------------- */
  const API = "/api/vision";


  /* --------------------------------------------------------
     4. Загрузить список визий
  -------------------------------------------------------- */
  async function loadVisions() {
    try {
      console.log("📡 Загружаем список визий…");

      const url = `${API}/list?user_id=${encodeURIComponent(USER_ID)}`;
      console.log("GET:", url);

      const res = await fetch(url);

      console.log("status:", res.status);

      if (!res.ok) throw new Error("Ошибка загрузки визий");

      const data = await res.json();
      console.log("Ответ API:", data);

      let visions = [];

      // поддержка обоих форматов
      if (Array.isArray(data)) {
        visions = data;
      } else if (data && Array.isArray(data.visions)) {
        visions = data.visions;
      } else {
        console.warn("⚠ API вернул неизвестный формат:", data);
      }

      renderVisionList(visions);

    } catch (err) {
      console.error("❌ Ошибка loadVisions:", err);

      listContainer.innerHTML = `
        <div style="text-align:center; padding:20px; color:#777;">
          Не удалось загрузить список визий 😢
        </div>
      `;
    }
  }


  /* --------------------------------------------------------
     5. Рендер списка визий
  -------------------------------------------------------- */
  function renderVisionList(list) {
    console.log("renderVisionList:", list);

    listContainer.innerHTML = "";

    if (!list || list.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding:20px; color:#777;">
          У вас ещё нет визий. Создайте первую ✨
        </div>
      `;
      return;
    }

    list.forEach(v => {
      const div = document.createElement("div");
      div.className = "vision-list-item";
      div.dataset.visionId = v.id;

      const createdAt = v.created_at
        ? new Date(v.created_at).toLocaleDateString("ru-RU")
        : "";

      div.innerHTML = `
        <div class="vision-list-item-title">${v.title || "Без названия"}</div>
        <div class="vision-list-item-meta">${createdAt}</div>
      `;

      div.onclick = () => openVision(v.id);

      listContainer.appendChild(div);
    });
  }


  /* --------------------------------------------------------
     6. Создание новой визии
  -------------------------------------------------------- */

  function generateVisionTitle() {
    const n = new Date();
    return `Визия ${n.toLocaleDateString("ru-RU")} ${n.getHours()}:${String(n.getMinutes()).padStart(2, "0")}`;
  }

  async function createVision() {
    try {
      console.log("➕ Создание новой визии…");

      // 1. Создаём пустую визию
      const res = await fetch(`${API}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID })
      });

      const data = await res.json();
      console.log("Ответ create:", data);

      if (!data.vision_id) {
        alert("Ошибка создания визии");
        return;
      }

      // 2. Даём ей название
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

      console.log("✔ Визия создана, открываем её");

      // 3. Переходим
      window.location.href = `/vision/vision.html?id=${data.vision_id}`;

    } catch (err) {
      console.error("❌ Ошибка createVision:", err);
      alert("Ошибка при создании визии");
    }
  }


  /* --------------------------------------------------------
     7. Открытие визии
  -------------------------------------------------------- */
  function openVision(id) {
    if (!id) return;
    window.location.href = `/vision/vision.html?id=${id}`;
  }


  /* --------------------------------------------------------
     8. События
  -------------------------------------------------------- */
  if (createBtn) {
    createBtn.onclick = () => createVision();
  } else {
    console.warn("⚠ Кнопка createVisionBtn не найдена");
  }


  /* --------------------------------------------------------
     9. Запуск
  -------------------------------------------------------- */
  loadVisions();
});
