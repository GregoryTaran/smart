// smart/login/login.js — Login под AUTH v3 + SVID v2

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
      throw new Error(data.error || data.detail || data.message || ('Ошибка ' + res.status));
    }

    return data;
  }

  // --- РЕГИСТРАЦИЯ --------------------------------------------------
  formRegister.addEventListener('submit', async e => {
    e.preventDefault();

    const name  = regName.value.trim();
    const email = regEmail.value.trim();
    const pass  = regPass.value.trim();

    if (!name)  return showStatus('Введите имя', 'error');
    if (!email) return showStatus('Введите email', 'error');
    if (!pass)  return showStatus('Введите пароль', 'error');

    try {
      await apiPost('/api/auth/register', { name, email, password: pass });

      showStatus('Регистрация успешна!', 'success');

      loginEmail.value = email;
      clearForm(formRegister);

      setTimeout(() => toggleForms('login'), 300);
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  // --- ВХОД ---------------------------------------------------------
  formLogin.addEventListener('submit', async e => {
    e.preventDefault();

    const email = loginEmail.value.trim();
    const pass  = loginPass.value.trim();

    if (!email) return showStatus('Введите email', 'error');
    if (!pass)  return showStatus('Введите пароль', 'error');

    try {
      const data = await apiPost('/api/auth/login', { email, password: pass });

      // Обновляем кэш SV_AUTH
      const AUTH_CACHE_KEY = 'sv.auth.cache.v1';
      const session = {
        isAuthenticated: true,
        userId: data?.user?.id || data.user_id || null,
        level: data?.user?.level || 2,
        levelCode: 'user',
        email: email,
        displayName: data?.user?.display_name || null,
        loaded: true
      };

      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(session));

      showStatus('Вход выполнен!', 'success');
      clearForm(formLogin);

      location.replace('index.html');
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  // --- СБРОС ПАРОЛЯ -------------------------------------------------
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

  // --- ПЕРЕКЛЮЧЕНИЯ -------------------------------------------------
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
