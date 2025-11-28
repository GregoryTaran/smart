// smart/login/login.js — чистая авторизация под AUTH v3 (без SVID логина)

(function () {
  const q  = sel => document.querySelector(sel);
  const qa = sel => Array.from(document.querySelectorAll(sel));

  const formRegister = q('#form-register');
  const formLogin    = q('#form-login');
  const formReset    = q('#form-reset');

  const statusBox    = q('#login-status');
  const resetResult  = q('#reset-result');

  const regName  = q('#reg-name');
  const regEmail = q('#reg-email');
  const regPass  = q('#reg-pass');

  const loginEmail = q('#login-email');
  const loginPass  = q('#login-pass');

  const resetEmail = q('#reset-email');

  let state = 'login';

  function showStatus(text, type='info') {
    if (!statusBox) return;
    statusBox.textContent = text || '';
    statusBox.dataset.type = type;
  }

  function clearForm(f) {
    if (!f) return;
    f.querySelectorAll('input').forEach(i => i.value = '');
  }

  function toggleForms(next) {
    state = next;

    formRegister.hidden = next !== 'register';
    formLogin.hidden    = next !== 'login';
    formReset.hidden    = next !== 'reset';

    showStatus('');
    resetResult.textContent = '';
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    let data = {};
    try { data = await res.json(); } catch {}

    if (!res.ok) {
      throw new Error(data.detail || data.error || 'Ошибка ' + res.status);
    }

    return data;
  }

  // ============================================================
  // РЕГИСТРАЦИЯ
  // ============================================================
  formRegister.addEventListener('submit', async e => {
    e.preventDefault();

    const name  = regName.value.trim();
    const email = regEmail.value.trim();
    const pass  = regPass.value.trim();

    if (!name)  return showStatus('Введите имя', 'error');
    if (!email) return showStatus('Введите email', 'error');
    if (!pass)  return showStatus('Введите пароль', 'error');

    try {
      await apiPost('/api/auth/register', {
        email,
        password: pass,
        data: { name }
      });

      showStatus('Регистрация успешна!', 'success');

      loginEmail.value = email;
      clearForm(formRegister);

      setTimeout(() => toggleForms('login'), 300);
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  // ============================================================
  // ВХОД
  // ============================================================
  formLogin.addEventListener('submit', async e => {
    e.preventDefault();

    const email = loginEmail.value.trim();
    const pass  = loginPass.value.trim();

    if (!email) return showStatus('Введите email', 'error');
    if (!pass)  return showStatus('Введите пароль', 'error');

    try {
      // 1) логин на бекенде (ставит куки)
      await apiPost('/api/auth/login', { email, password: pass });

      // 2) сразу обновляем AUTH через /me
      const resp = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include"
      });

      const data = await resp.json();

      if (!data.loggedIn) {
        throw new Error("Не удалось получить данные авторизации");
      }

      const u = data.user_merged || {};

      const session = {
        isAuthenticated: true,
        userId: u.id || null,
        email: u.email || null,
        displayName: u.name || null,
        level: data.level,
        levelCode: data.level_code,
        loaded: true
      };

      // 3) сохраняем кэш состояния
      localStorage.setItem('sv.auth.cache.v1', JSON.stringify(session));

      showStatus('Вход выполнен!', 'success');
      clearForm(formLogin);

      // 4) переход на главную
      location.replace('index.html');

    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  // ============================================================
  // СБРОС ПАРОЛЯ
  // ============================================================
  formReset.addEventListener('submit', async e => {
    e.preventDefault();

    const email = resetEmail.value.trim();
    if (!email) return showStatus('Введите email', 'error');

    try {
      const data = await apiPost('/api/auth/reset', { email });

      showStatus('Пароль сброшен, смотрите ниже', 'success');
      resetResult.textContent = 'Новый пароль: ' + (data.new_password || 'сгенерирован');

      clearForm(formReset);
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  // ============================================================
  // ПЕРЕКЛЮЧЕНИЯ ФОРМ
  // ============================================================
  qa('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.dataset.action;

      if (a === 'to-login')    toggleForms('login');
      if (a === 'to-register') toggleForms('register');
      if (a === 'to-reset')    toggleForms('reset');
    });
  });

  toggleForms('login');
})();
