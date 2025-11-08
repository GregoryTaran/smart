/*
 * Загружает фрагменты (menu/topbar/footer), включает мобильное меню,
 * подсвечивает активный пункт меню по URL.
 */
(function () {
  // Загрузить HTML-фрагмент в целевой контейнер
  async function loadFragment(path, targetSelector) {
    try {
      const resp = await fetch(path, { cache: "no-cache" }); // чтобы правки были видны сразу
      const html = await resp.text();
      const target = document.querySelector(targetSelector);
      if (target) target.innerHTML = html;
    } catch (e) {
      console.error("Не удалось загрузить фрагмент:", path, e);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    // Подгружаем фрагменты параллельно
    await Promise.all([
      loadFragment("menu.html", "#sidebar"),
      loadFragment("topbar.html", "#topbar"),
       // loadFragment("footer.html", "#footer"),
    ]);

    // После вставки — инициализируем меню и подсветку
    initMenuToggle();
    highlightActiveMenuItem();
  });

  // Логика мобильного меню
  function initMenuToggle() {
    const openBtn = document.querySelector('[data-action="open-menu"]');
    const overlay = document.getElementById("overlay");
    if (!openBtn || !overlay) return;

    const body = document.body;

    const open = () => {
      body.classList.add("menu-open");
      openBtn.setAttribute("aria-expanded", "true");
      overlay.hidden = false;
    };
    const close = () => {
      body.classList.remove("menu-open");
      openBtn.setAttribute("aria-expanded", "false");
      overlay.hidden = true;
    };

    openBtn.addEventListener("click", open);
    overlay.addEventListener("click", close);

    // Закрытие по Escape и по back/истории
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    window.addEventListener("popstate", close);
  }

  // Подсветка активного пункта меню (фон = #F5F5F5)
  function highlightActiveMenuItem() {
    const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const pageId = path.replace(/\.html$/, ""); // index.html -> index
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    const links = sidebar.querySelectorAll("a[data-id]");
    links.forEach((a) => {
      const id = (a.getAttribute("data-id") || "").toLowerCase();
      if (id === pageId) a.classList.add("is-active");
    });
  }
})();
