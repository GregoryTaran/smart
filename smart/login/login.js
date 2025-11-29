// login.js — новая версия под нашу PostgreSQL-авторизацию
// Умеет: регистрация, вход, сброс пароля с показом нового

(function () {
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const formRegister = $('#form-register');
  const formLogin    = $('#form-login');
  const formReset    = $('#form-reset');

  const statusBox    = $('#login-status');
  const resetResult  = $('#reset-result');

  function showStatus(text, type = 'info') {
    if (!statusBox) return;
    statusBox.textContent = text;
    statusBox.dataset.type = type;
  }

  function switchTo(mode) {
    if (formRegister) formRegister.hidden = mode !== 'register';
    if (formLogin)    formLogin.hidden    = mode !== 'login';
    if (formReset)    formReset.hidden    = mode !== 'reset';
    showStatus('');
    if (resetResult) resetResult.textContent = '';
  }

  // универсальные запросы
  async function apiPOST(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.detail || json.error || "Ошибка");
    return json;
  }

  // ------------------------------------------------------
  // РЕГИСТРАЦИЯ
  // ------------------------------------------------------
  if (formRegister) {
    formRegister.addEventListener('submit', async e => {
      e.preventDefault();

      const name  = $('#reg-name')?.value.trim()  || '';
      const email = $('#reg-email')?.value.trim() || '';
      const pass  = $('#reg-pass')?.value.trim()  || '';

      if (!name)  return showStatus("Введите имя", "error");
      if (!email) return showStatus("Введите email", "error");
      if (!pass)  return showStatus("Введите пароль", "error");

      try {
        await apiPOST('/api/auth/register', { name, email, password: pass });

        showStatus("Регистрация успешна!", "success");
        const loginEmail = $('#login-email');
        if (loginEmail) loginEmail.value = email;

        switchTo('login');
      } catch (err) {
        showStatus(err.message, "error");
      }
    });
  }

  // ------------------------------------------------------
  // ВХОД
  // ------------------------------------------------------
  if (formLogin) {
    formLogin.addEventListener('submit', async e => {
      e.preventDefault();

      const email = $('#login-email')?.value.trim() || '';
      const pass  = $('#login-pass')?.value.trim()  || '';

      if (!email) return showStatus("Введите email", "error");
      if (!pass)  return showStatus("Введите пароль", "error");

      try {
        await apiPOST('/api/auth/login', { email, password: pass });

        // /api/auth/me дергает smartid.init.js на новой странице — тут не нужно
        location.replace('/index.html');

      } catch (err) {
        showStatus(err.message, 'error');
      }
    });
  }

  // ------------------------------------------------------
  // СБРОС ПАРОЛЯ — ЧЕРЕЗ НАШ /api/auth/reset
  // ------------------------------------------------------
  if (formReset) {
    formReset.addEventListener('submit', async e => {
      e.preventDefault();

      const email = $('#reset-email')?.value.trim() || '';
      if (!email) return showStatus("Введите email", "error");

      try {
        const out = await apiPOST('/api/auth/reset', { email });
        if (resetResult) {
          resetResult.textContent = "Новый пароль: " + (out.new_password || "—");
        }
        showStatus("Пароль сброшен", "success");
      } catch (err) {
        showStatus(err.message, 'error');
      }
    });
  }

  // переключатели (ссылки "Перейти к логину/регистрации/сбросу")
  $$('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const mode = el.dataset.action.replace('to-', '');
      switchTo(mode);
    });
  });

  switchTo('login');
})();
