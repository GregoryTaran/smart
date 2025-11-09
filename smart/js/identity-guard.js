// /smart/js/identity-guard.js
(function () {
  // ——— конфиг (можно подтягивать из window.SV_CONFIG, если захочешь) ———
  const SUPABASE_URL = "https://bqtlomddtojirtkazpvj.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdGxvbWRkdG9qaXJ0a2F6cHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NzgyODcsImV4cCI6MjA3ODI1NDI4N30.Q6c_Ehc9WmjcF5FNNT-48GGy60Rk53i3t99K5zqTSJk";

  // если нет библиотеки — выходим молча
  if (!window.supabase) {
    console.warn("identity-guard: supabase-js не подключен; работаю пассивно");
    window.SV = Object.assign(window.SV || {}, {
      ready: Promise.resolve(),
      session: null,
      user: null,
      showUser() {},
      showUptime() {},
    });
    return;
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const startedAt = Date.now();

  const SV = (window.SV = window.SV || {});
  SV.session = null;
  SV.user = null;

  // готовность
  let _resolves = [];
  SV.ready = new Promise((res) => _resolves.push(res));

  // утилиты (без редиректов!)
  SV.showUser = (sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel || document.querySelector('[data-sv="user"]');
    if (!el) return;
    el.textContent = SV.user ? (SV.user.email || SV.user.id) : "";
  };

  SV.showUptime = (sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel || document.querySelector('[data-sv="uptime"]');
    if (!el) return;
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, "0");
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = String(s % 60).padStart(2, "0");
      el.textContent = `${h}:${m}:${sec}`;
    };
    tick();
    setInterval(tick, 1000);
  };

  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      SV.session = session || null;
      SV.user = session?.user || null;

      // авто-подстановка, если элементы есть
      const idEl = document.querySelector('[data-sv="user-id"]');
      if (idEl && SV.user) idEl.textContent = SV.user.id;
      const emailEl = document.querySelector('[data-sv="user-email"]');
      if (emailEl && SV.user) emailEl.textContent = SV.user.email;

      // аптайм, если элемент присутствует
      if (document.querySelector('[data-sv="uptime"]')) SV.showUptime();

      _resolves.forEach((fn) => { try { fn(); } catch {} });
      _resolves.length = 0;

      // обновлять при изменении сессии
      supabase.auth.onAuthStateChange((_ev, newSession) => {
        SV.session = newSession || null;
        SV.user = newSession?.user || null;
        if (idEl) idEl.textContent = SV.user ? SV.user.id : "";
        if (emailEl) emailEl.textContent = SV.user ? SV.user.email : "";
      });
    } catch (e) {
      console.warn("identity-guard: init error", e);
      _resolves.forEach((fn) => { try { fn(); } catch {} });
      _resolves.length = 0;
    }
  })();
})();
