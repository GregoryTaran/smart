// ===========================================================
// SMARTID INIT — единая точка истины во всей системе
// ===========================================================

window.SmartID = {
  session: null,
  ready: null
};

// -----------------------------------------------------------
// SmartID.ready — промис, который выполняется один раз
// -----------------------------------------------------------
window.SmartID.ready = new Promise(async (resolve) => {

  let data;
  try {
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include'
    });

    data = res.ok ? await res.json() : {};
  } catch (e) {
    data = {};
  }

  // ---------------------------------------------------------
  // Приводим ответ к единому формату (стабильность важна)
  // ---------------------------------------------------------
  window.SmartID.session = {
    authenticated: !!data.is_authenticated || !!data.authenticated,
    user_id: data.user_id || null,
    email: data.email || null,
    level: data.level || (data.is_authenticated ? 2 : 1)
  };

  resolve(window.SmartID.session);
});

// -----------------------------------------------------------
// ПОСЛЕ ГОТОВНОСТИ DOM → рендер меню + топбара + футера
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const session = await window.SmartID.ready;

  // ------------------- Грузим меню HTML -------------------
  try {
    const menuHtml = await fetch('menu.html', { cache: 'no-cache' }).then(r => r.text());
    const sidebar = document.querySelector('#sidebar');
    if (sidebar) sidebar.innerHTML = menuHtml;
  } catch (e) {
    console.warn("Не удалось загрузить меню:", e);
  }

  // ------------------- ИНИЦИАЛИЗАЦИЯ МОДУЛЕЙ -------------------
  if (typeof window.renderTopbar === 'function') {
    window.renderTopbar(session);
  }

  if (typeof window.renderMenu === 'function') {
    window.renderMenu(session.level);
  }

  if (typeof window.renderFooter === 'function') {
    window.renderFooter(session);
  }
});
