// --- Supabase client setup ---
const SUPABASE_URL = "https://bqtlomddtojirtkazpvj.supabase.co"; // заменишь
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdGxvbWRkdG9qaXJ0a2F6cHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NzgyODcsImV4cCI6MjA3ODI1NDI4N30.Q6c_Ehc9WmjcF5FNNT-48GGy60Rk53i3t99K5zqTSJk";               // заменишь
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- DOM elements ---
const formLogin = document.getElementById("login-form");
const formReg = document.getElementById("register-form");
const statusLogin = document.getElementById("login-status");
const statusReg = document.getElementById("register-status");
const btnSignup = document.getElementById("signup-btn");

const setStatus = (el, t) => (el.textContent = t || "");

function show(mode) {
  const isLogin = mode !== "register";
  formLogin.classList.toggle("hidden", !isLogin);
  formReg.classList.toggle("hidden", isLogin);
}
function currentMode() {
  const h = (location.hash || "").slice(1).toLowerCase();
  return h === "register" ? "register" : "login";
}
window.addEventListener("hashchange", () => show(currentMode()));
if (!location.hash) location.hash = "#login";
show(currentMode());

btnSignup?.addEventListener("click", () => { location.hash = "#register"; });

// --- LOGIN ---
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const password = e.target.password.value.trim();
  if (!email || !password) return setStatus(statusLogin, "Введите email и пароль");
  setStatus(statusLogin, "Входим…");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return setStatus(statusLogin, error.message);
  window.location.href = "/";
});

// --- REGISTER ---
formReg?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const password = e.target.password.value.trim();
  const name = e.target.name.value.trim();
  if (!email || !password) return setStatus(statusReg, "Введите email и пароль");
  setStatus(statusReg, "Регистрируем…");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });
  if (error) return setStatus(statusReg, error.message);
  window.location.href = "/";
});
