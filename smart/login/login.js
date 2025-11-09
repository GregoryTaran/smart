// --- Supabase client setup ---
const SUPABASE_URL = "https://bqtlomddtojirtkazpvj.supabase.co"; // твой URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdGxvbWRkdG9qaXJ0a2F6cHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NzgyODcsImV4cCI6MjA3ODI1NDI4N30.Q6c_Ehc9WmjcF5FNNT-48GGy60Rk53i3t99K5zqTSJk"; // твой anon key
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- DOM elements ---
const formLogin = document.getElementById("login-form");
const formReg   = document.getElementById("register-form");
const statusLogin = document.getElementById("login-status");
const statusReg   = document.getElementById("register-status");
const btnSignup = document.getElementById("signup-btn");

const setStatus = (el, t) => el && (el.textContent = t || "");

// ---------- НОВОЕ: аккуратная автоочистка форм ----------
function resetForm(elForm) {
  if (!elForm) return;
  // Сброс стандартный
  elForm.reset();
  // Жёсткая очистка важных полей (если вдруг браузер что-то оставил)
  elForm.querySelectorAll("input[type='email'], input[type='text'], input[type='password']").forEach(inp => {
    // Не мешаем менеджеру паролей — даём шанс авто-подставить ПОСЛЕ нашей очистки
    inp.value = "";
  });
}

function wipeAll() {
  resetForm(formLogin);
  resetForm(formReg);
  setStatus(statusLogin, "");
  setStatus(statusReg, "");
}

function wipeWithDelays() {
  // Мгновенно
  wipeAll();
  // Через тик — если браузер подставит кэшированные значения синхронно
  setTimeout(wipeAll, 0);
  // И небольшой повтор — на случай поздней автоподстановки (Safari / bfcache)
  setTimeout(wipeAll, 300);
}

// Автоочистка при первой загрузке
document.addEventListener("DOMContentLoaded", () => {
  // Если нет хэштега — по умолчанию #login (как у тебя было)
  if (!location.hash) location.hash = "#login";
  show(currentMode());
  // Формы не должны хранить автозаполнения между обновлениями
  formLogin?.setAttribute("autocomplete", "off");
  formReg?.setAttribute("autocomplete", "off");
  wipeWithDelays();
});

// Автоочистка при возврате со “стрелки назад” (bfcache)
window.addEventListener("pageshow", (e) => {
  // Если страница из кэша — жёстко протираем формы
  if (e.persisted) wipeWithDelays();
});

// ---------- Переключение режимов (как у тебя), + очистка неактивной формы ----------
function show(mode) {
  const isLogin = mode !== "register";
  formLogin?.classList.toggle("hidden", !isLogin);
  formReg?.classList.toggle("hidden", isLogin);

  // Чистим формы при переключении вкладок, чтобы не оставались “хвосты”
  if (isLogin) {
    resetForm(formReg);
    setStatus(statusReg, "");
  } else {
    resetForm(formLogin);
    setStatus(statusLogin, "");
  }

  (isLogin ? formLogin : formReg)?.querySelector("input")?.focus();
}

function currentMode() {
  const h = (location.hash || "").slice(1).toLowerCase();
  return h === "register" ? "register" : "login";
}

window.addEventListener("hashchange", () => show(currentMode()));
btnSignup?.addEventListener("click", () => { location.hash = "#register"; });

// ---------- LOGIN ----------
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const password = e.target.password.value.trim();
  if (!email || !password) return setStatus(statusLogin, "Введите email и пароль");
  setStatus(statusLogin, "Входим…");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return setStatus(statusLogin, error.message);

  // На успехе можно ещё раз очистить, чтобы история не оставалась
  wipeAll();
  window.location.href = "/";
});

// ---------- REGISTER ----------
formReg?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  const email = e.target.email.value.trim();
  const password = e.target.password.value.trim();
  if (!name || !email || !password) return setStatus(statusReg, "Заполните все поля");
  setStatus(statusReg, "Регистрируем…");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });
  if (error) return setStatus(statusReg, error.message);

  wipeAll();
  window.location.href = "/";
});
