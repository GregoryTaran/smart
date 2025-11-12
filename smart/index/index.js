// index/index.js — «экран радости» на главной: кто вошёл и какой уровень

(function () {
  const BOX_SEL = '#svid-box';

  // коротко выводим id'шники
  const short = (s) => (s && s.length > 12) ? `${s.slice(0,6)}…${s.slice(-4)}` : (s || '—');

  // чтение локального состояния
  function localState() {
    const S = window.SVID;
    const st = S?.getState?.() || {};
    const level = S?.getLevel?.() ?? 1;
    return {
      level,
      visitor_id: st.visitor_id || null,
      user_id: st.user_id || null,
      has_jwt: !!st.jwt,
    };
  }

  // рендер карточки в центр
  function renderCard({ level, visitor_id, user_id, profile }) {
    const el = document.querySelector(BOX_SEL);
    if (!el) return;
    const rows = [
      `<div><b>level:</b> ${level}</div>`,
      `<div><b>visitor_id:</b> ${short(visitor_id)}</div>`,
      `<div><b>user_id:</b> ${short(user_id)}</div>`,
    ];
    if (profile) {
      rows.push(
        `<div><b>display_name:</b> ${profile.display_name ?? '—'}</div>`,
        `<div><b>email:</b> ${profile.email ?? '—'}</div>`
      );
    }
    el.innerHTML = `
      <div style="
        max-width:560px;margin:24px auto;padding:16px 18px;border-radius:12px;
        background:#f7f8fb;box-shadow:0 1px 3px rgba(0,0,0,.06);font:14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
        <div style="font-weight:600;margin-bottom:8px">Статус авторизации</div>
        ${rows.join('')}
        <div style="margin-top:10px;color:#666">
          ${level >= 2 ? 'Пользователь авторизован.' : 'Гость. Войдите, чтобы увидеть данные пользователя.'}
        </div>
      </div>
    `;
  }

  // попытка запросить профиль /api/svid/me (если есть jwt)
  async function fetchProfileIfPossible() {
    try {
      if (!window.SVID?.me) return null;
      const st = window.SVID.getState?.() || {};
      if (!st.jwt) return null; // нечем авторизоваться
      const p = await window.SVID.me(); // { user_id, display_name, email, level }
      return p || null;
    } catch {
      return null; // не валим карточку, просто без профиля
    }
  }

  async function boot() {
    // 1) первый рендер из локального стора
    renderCard(localState());

    // 2) дёрнем /me при наличии токена — и дорисуем профиль
    const profile = await fetchProfileIfPossible();
    if (profile) {
      const base = localState();
      renderCard({ ...base, profile });
    }

    // 3) подписки: изменение уровня/состояния
    window.addEventListener('svid:level', async (e) => {
      const base = localState();
      // если стал юзером — попробуем подтянуть профиль
      const prof = base.level >= 2 ? (await fetchProfileIfPossible()) : null;
      renderCard({ ...base, profile: prof || null });
    });
    window.addEventListener('svid:user', async () => {
      const base = localState();
      const prof = await fetchProfileIfPossible();
      renderCard({ ...base, profile: prof || null });
    });
    window.addEventListener('svid:logout', () => {
      renderCard(localState());
    });

    // 4) bfcache (назад/вперёд)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) renderCard(localState());
    });
  }

  // ждём инициализации SVID (если есть промис), иначе сразу грузимся
  const ready = window.SVID?.ready || Promise.resolve();
  ready.finally(boot);
})();
