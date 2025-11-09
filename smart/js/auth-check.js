// --- auth-check.js ---
// Проверяет, вошёл ли пользователь в систему через Supabase.
// Если нет — перекидывает на страницу логина.

const SUPABASE_URL = "https://bqtlomddtojirtkazpvj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdGxvbWRkdG9qaXJ0a2F6cHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NzgyODcsImV4cCI6MjA3ODI1NDI4N30.Q6c_Ehc9WmjcF5FNNT-48GGy60Rk53i3t99K5zqTSJk";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { data: { session } } = await supabase.auth.getSession();

  // Если нет активной сессии — редиректим на логин
  if (!session) {
    console.log("🪪 Нет сессии, редирект на логин...");
    window.location.href = "/smart/login/login.html";
    return;
  }

  // Если вошёл — можно получить данные пользователя
  const user = session.user;
  console.log("✅ Пользователь вошёл:", user.email);

  // Можно, например, показать имя/емейл в интерфейсе:
  const el = document.getElementById("user-email");
  if (el) el.textContent = user.email;
})();
