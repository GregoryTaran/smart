// /smart/login/login.js
// Login & Register via backend endpoints to set HttpOnly cookies.
// Requires: a page with forms #login-form and #register-form as in login.html.

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  const loginForm    = $("#login-form");
  const registerForm = $("#register-form");
  const btnSignupTab = $("#signup-btn");
  const statusLogin  = $("#login-status");
  const statusReg    = $("#register-status");

  // ---- small utils ----
  function setStatus(el, text, type = "info") {
    if (!el) return;
    el.textContent = text || "";
    el.dataset.type = type; // style in CSS if needed
  }
  function wipeAll() {
    try {
      // clean sensitive inputs
      ["#password", "#reg-password"].forEach((id) => { const i = $(id); if (i) i.value = ""; });
    } catch {}
  }
  function showLogin() {
    if (loginForm)    loginForm.classList.remove("hidden");
    if (registerForm) registerForm.classList.add("hidden");
    setStatus(statusReg, "");
    location.hash = "#login";
  }
  function showRegister() {
    if (loginForm)    loginForm.classList.add("hidden");
    if (registerForm) registerForm.classList.remove("hidden");
    setStatus(statusLogin, "");
    location.hash = "#register";
  }
  function initTabs() {
    if (btnSignupTab) {
      btnSignupTab.addEventListener("click", (e) => { e.preventDefault(); showRegister(); });
    }
    // hash navigation
    if (location.hash === "#register") showRegister();
    else                                showLogin();
    window.addEventListener("hashchange", () => {
      if (location.hash === "#register") showRegister(); else showLogin();
    });
  }

  // ---- LOGIN ----
  async function doLogin(email, password) {
    setStatus(statusLogin, "Входим...", "info");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const t = await r.text();
        setStatus(statusLogin, t || "Ошибка входа", "error");
        return;
      }
      // Server has set HttpOnly cookies. Redirect to home.
      setStatus(statusLogin, "Успешный вход. Перенаправление...", "ok");
      wipeAll();
      // Let other tabs update faster
      try { localStorage.setItem("sv_auth", "loggedIn"); } catch {}
      setTimeout(() => { window.location.href = "index.html"; }, 300);
    } catch (e) {
      console.error(e);
      setStatus(statusLogin, "Сеть недоступна", "error");
    }
  }

  // ---- REGISTER ----
  async function doRegister(name, email, password) {
    setStatus(statusReg, "Создаём аккаунт...", "info");
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!r.ok) {
        const t = await r.text();
        setStatus(statusReg, t || "Ошибка регистрации", "error");
        return;
      }
      setStatus(statusReg, "Готово! Теперь войдите под своим email и паролем.", "ok");
      // Optionally, auto-login after register:
      // await doLogin(email, password);
      showLogin();
    } catch (e) {
      console.error(e);
      setStatus(statusReg, "Сеть недоступна", "error");
    }
  }

  // ---- Bind forms ----
  function bindForms() {
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = $("#email")?.value?.trim();
        const password = $("#password")?.value || "";
        if (!email || !password) {
          setStatus(statusLogin, "Введите email и пароль", "warn");
          return;
        }
        doLogin(email, password);
      });
    }

    if (registerForm) {
      registerForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = $("#reg-name")?.value?.trim();
        const email = $("#reg-email")?.value?.trim();
        const password = $("#reg-password")?.value || "";
        if (!name || !email || !password) {
          setStatus(statusReg, "Заполните все поля", "warn");
          return;
        }
        doRegister(name, email, password);
      });
    }
  }

  // ---- init ----
  function init() {
    initTabs();
    bindForms();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();