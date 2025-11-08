// js/features/auth-status.js
(function () {
  const STORAGE_KEY = "sv_auth";

  const getAuth = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  };
  const setAuth = v => {
    if (!v) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  };

  function applyHeader() {
    // ищем ссылку и в подгруженном топбаре, и на случай иных шаблонов
    const link =
      document.querySelector(".topbar-inner .login-link") ||
      document.querySelector("#topbar .login-link");
    if (!link) return false; // сигнал «пока нет топбара»

    const auth = getAuth();
    if (auth && auth.email) {
      link.textContent = "Выйти";
      link.href = "#logout";
      link.onclick = (e) => {
        e.preventDefault();
        setAuth(null);
        applyHeader();     // мгновенно обновить вид
        location.assign("/"); // и увести на главную
      };
      link.title = auth.email;
    } else {
      link.textContent = "Логин";
      link.href = "login/login.html#login";
      link.onclick = null;
      link.removeAttribute("title");
    }
    return true; // применили
  }

  function waitTopbarAndApply() {
    // 1) попытка сразу (вдруг уже вставлен)
    if (applyHeader()) return;

    // 2) ждём вставку контента в #topbar
    const topbar = document.getElementById("topbar");
    if (!topbar) {
      // если ещё нет самого контейнера — подождём DOMContentLoaded и повторим
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", waitTopbarAndApply, { once: true });
      } else {
        // редкий случай: нет #topbar вовсе — пробуем позже
        setTimeout(waitTopbarAndApply, 0);
      }
      return;
    }

    // следим за наполнением #topbar фрагментом
    const mo = new MutationObserver(() => {
      if (applyHeader()) mo.disconnect(); // как только ссылка нашлась — выключаем наблюдатель
    });
    mo.observe(topbar, { childList: true, subtree: true });

    // подстраховка: если фрагмент уже успел приехать между вызовами
    setTimeout(() => applyHeader(), 0);
  }

  // стартуем
  waitTopbarAndApply();

  // если localStorage меняют в другой вкладке — обновим вид
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) applyHeader();
  });

  // экспорт на всякий
  window.__svAuthStatus = { applyHeader };
})();
