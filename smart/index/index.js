// smart/index.js — минимальный, но честный статус по SVID
(() => {
  const fmt = (s) => (s == null ? "—" : String(s));
  const short = (id) => (id ? String(id).slice(0, 6) + "…"+ String(id).slice(-4) : "—");

  function getLocal() {
    return {
      visitor_id: localStorage.getItem("svid.visitor_id"),
      visitor_level: +(localStorage.getItem("svid.visitor_level") || 0) || 0,
      user_id: localStorage.getItem("svid.user_id"),
      user_level: +(localStorage.getItem("svid.user_level") || 0) || 0,
      jwt: localStorage.getItem("svid.jwt"),
      level: +(localStorage.getItem("svid.level") || 0) || 0,
    };
  }

  function mountPanel() {
    let box = document.getElementById("svid-status");
    if (!box) {
      box = document.createElement("div");
      box.id = "svid-status";
      box.style.cssText = `
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size:14px; line-height:1.45;
        background:#0b1324; color:#e7eefc;
        border:1px solid #2b3a67; border-radius:12px;
        padding:14px 16px; margin:16px auto; max-width:720px;
        box-shadow: 0 6px 24px rgba(0,0,0,.15);
      `;
      document.body.prepend(box);
    }
    return box;
  }

  function computeLevel(profile, st) {
    // Источник истины — профиль из /me
    return (profile && typeof profile.level === "number")
      ? profile.level
      : (st.user_level || st.visitor_level || st.level || 1);
  }

  function render(profile) {
    const root = mountPanel();
    const st = getLocal();
    const effectiveLevel = computeLevel(profile, st);

    // поддержим кэш уровня для остального UI
    localStorage.setItem("svid.level", String(effectiveLevel));

    const statusTitle = effectiveLevel >= 2 ? "Статус: пользователь" : "Статус: гость";
    const hint = effectiveLevel >= 2
      ? "Вы вошли. Доступно меню пользователя."
      : "Гость. Войдите, чтобы увидеть данные пользователя.";

    const rows = [
      `<div style="font-weight:700;margin-bottom:6px">${statusTitle}</div>`,
      `<div><b>level:</b> ${effectiveLevel}</div>`,
      `<div><b>visitor_id:</b> ${short(st.visitor_id)}</div>`,
      `<div><b>user_id:</b> ${short(st.user_id)}</div>`,
      `<div><b>display_name:</b> ${fmt(profile?.display_name)}</div>`,
      `<div><b>email:</b> ${fmt(profile?.email)}</div>`,
      `<div style="opacity:.85;margin-top:8px">${hint}</div>`
    ];

    root.innerHTML = rows.join("");
  }

  async function boot() {
    try {
      // 1) гарантируем визитора
      const st = getLocal();
      if (!st.visitor_id) {
        try { await window.SVID?.identify?.(); } catch {}
      }

      // 2) пытаемся получить профиль
      let me = null;
      try { me = await window.SVID?.me?.(); } catch { me = null; }

      // 3) рисуем
      render(me);
    } catch (e) {
      console.error("SVID index init error:", e);
    }
  }

  // Перерисовываем на событиях
  window.addEventListener("svid:visitor", () => boot());
  window.addEventListener("svid:user", () => boot());
  window.addEventListener("svid:logout", () => boot());

  // Первый запуск
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
