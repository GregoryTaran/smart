// js/features/auth-status.js
(function () {
  function getAuth() {
    try { return JSON.parse(localStorage.getItem("sv_auth") || "null"); } catch { return null; }
  }
  function setAuth(v) {
    if (!v) localStorage.removeItem("sv_auth");
    else localStorage.setItem("sv_auth", JSON.stringify(v));
  }
  function applyHeader() {
    const link = document.querySelector(".topbar-inner .login-link");
    if (!link) return;
    const auth = getAuth();
    if (auth && auth.email) {
      link.textContent = "Выйти";
      link.href = "#logout";
      link.onclick = (e) => {
        e.preventDefault();
        setAuth(null);
        applyHeader();
        location.assign("/");
      };
      link.title = auth.email;
    } else {
      link.textContent = "Логин";
      link.href = "login/login.html#login";
      link.onclick = null;
      link.removeAttribute("title");
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(applyHeader, 0));
  } else {
    setTimeout(applyHeader, 0);
  }
  window.__svAuthStatus = { applyHeader };
})();
