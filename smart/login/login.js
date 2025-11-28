// login.js — финальная версия под smartid.init + Supabase backend

(function () {
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const formRegister = $('#form-register');
  const formLogin    = $('#form-login');
  const formReset    = $('#form-reset');

  const statusBox    = $('#login-status');
  const resetResult  = $('#reset-result');

  function showStatus(text, type='info') {
    statusBox.textContent = text;
    statusBox.dataset.type = type;
  }

  function switchTo(mode) {
    formRegister.hidden = mode !== 'register';
    formLogin.hidden    = mode !== 'login';
    formReset.hidden    = mode !== 'reset';

    showStatus('');
    resetResult.textContent = '';
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    let json = {};
    try { json = await res.json(); } catch {}

    if (!res.ok) {
      throw new Error(json.detail || json.error || 'Ошибка ' + res.status);
    }
    return json;
  }


  // ------------------------------------------------------
  // 1. РЕГИСТРАЦИЯ
  // ------------------------------------------------------
  formRegister.addEventListener('submit', async e => {
    e.preventDefault();

    const name  = $('#reg-name').value.trim();
    const email = $('#reg-email').value.trim();
    const pass  = $('#reg-pass').value.trim();

    if (!name)  return showStatus('Введите имя', 'error');
    if (!email) return showStatus('Введите email', 'error');
    if (!pass)  return showStatus('Введите пароль', 'error');

    try {

      await api('/api/auth/register', {
        email,
        password: pass,
        data: { name }
      });

      showStatus('Регистрация успешна! Теперь войдите.', 'success');
      $('#login-email').value = email;

      switchTo('login');

    } catch (err) {
      showStatus(err.message, 'error');
    }
  });


  // ------------------------------------------------------
  // 2. ВХОД
  // ------------------------------------------------------
  formLogin.addEventListener('submit', async e => {
    e.preventDefault();

    const email = $('#login-email').value.trim();
    const pass  = $('#login-pass').value.trim();

    if (!email) return showStatus('Введите email', 'error');
    if (!pass)  return showStatus('Введите пароль', 'error');

    try {
      // 1) логиним
      await api('/api/auth/login', { email, password: pass });

      // 2) проверяем /me (это важно!)
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());

      if (!me.loggedIn) {
        throw new Error('Авторизация не подтверждена');
      }

      // 3) редирект
      location.replace('/index.html');

    } catch (err) {
      showStatus(err.message, 'error');
    }
  });


// ------------------------------------------------------
// 3. RESET PASSWORD (DEV MODE)
// ------------------------------------------------------
formReset.addEventListener('submit', async e => {
  e.preventDefault();

  const email = $('#reset-email').value.trim();
  if (!email) return showStatus('Введите email', 'error');

  try {
    // DEV RESET — генерирует новый пароль и возвращает его
    const out = await api('/api/auth/reset-dev', { email });

    showStatus('Пароль сброшен (DEV)', 'success');
    resetResult.textContent = 'Новый пароль: ' + out.new_password;

  } catch (err) {
    showStatus(err.message, 'error');
  }
});



  // ------------------------------------------------------
  // Переключатели форм
  // ------------------------------------------------------
  $$('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      switchTo(el.dataset.action.replace('to-', ''));
    });
  });

  switchTo('login');

})();
