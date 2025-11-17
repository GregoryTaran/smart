// /smart/login/login.js
// Аутентификатор страницы (register / login / reset) поверх НОВОГО backend API.
// Теперь работаем через /api/auth/register, /api/auth/login, /api/auth/reset.
// Валидация email: только наличие '@'.

(function () {
  const q  = (sel) => document.querySelector(sel);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));

  // Формы и элементы
  const formRegister = q('#svid-form-register');
  const formLogin    = q('#svid-form-login');
  const formReset    = q('#svid-form-reset');

  const statusBox    = q('#svid-status');
  const resetResult  = q('#reset-result');

  // Поля регистрации
  const regName  = q('#reg-name');
  const regEmail = q('#reg-email');
  const regPass  = q('#reg-pass');

  // Поля входа
  const loginEmail = q('#login-email');
  const loginPass  = q('#login-pass');

  // Поля сброса
  const resetEmail = q('#reset-email');

  // Состояния: register | login | reset
  let state = 'login';

  // --------- Утилиты ---------

  function hasAtSymbol(email) {
    return typeof email === 'string' && email.includes('@');
  }

  function showStatus(message, type = 'info') {
    if (!statusBox) return;
    statusBox.textContent = message || '';
    statusBox.dataset.type = type; // [data-type="error|success|info"]
  }

  function showResetResult(message) {
    if (!resetResult) return;
    resetResult.textContent = message || '';
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute('hidden', 'hidden');
    else el.removeAttribute('hidden');
  }

  function disableButton(btn, v = true) {
    if (btn) btn.disabled = v;
  }

  function findSubmitButton(form) {
    if (!form) return null;
    return form.querySelector('button[type="submit"]');
  }

  function clearForm(form) {
    if (!form) return;
    const fields = form.querySelectorAll('input, textarea, select');
    fields.forEach((el) => {
      switch (el.type) {
        case 'checkbox':
        case 'radio':
          el.checked = false;
          break;
        default:
          el.value = '';
      }
    });
  }

  // Универсальный редирект на index.html с учётом <base>
  function redirectToIndex() {
    try {
      const url = new URL('index.html', document.baseURI).href;
      location.replace(url);
    } catch (e) {
      location.replace('index.html');
    }
  }

  function injectClearButton(form) {
    if (!form) return;
    const wrap = form.querySelector('.login__links') || form;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'login__link';
    btn.textContent = 'Очистить поля';
    btn.addEventListener('click', () => {
      clearForm(form);
      showStatus('Поля очищены.', 'info');
      if (form === formReset) showResetResult('');
    });
    wrap.appendChild(btn);
  }

  function setState(next) {
    state = next;
    setHidden(formRegister, state !== 'register');
    setHidden(formLogin,    state !== 'login');
    setHidden(formReset,    state !== 'reset');

    showStatus('');
    showResetResult('');

    const activeForm =
      state === 'register' ? formRegister :
      state === 'login'    ? formLogin :
                             formReset;
    activeForm?.querySelector('input, select, textarea')?.focus();
  }

  // --------- Работа с backend /api/auth/... ---------

  async function apiPost(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // важно для установки/отправки куки
      body: JSON.stringify(payload || {}),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.detail || data.error || data.message)) ||
        `Ошибка запроса (${res.status})`;
      throw new Error(msg);
    }
    return data || {};
  }

  // --------- Обработчики форм ---------

  // Регистрация: /api/auth/register
  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');

    const name  = (regName?.value || '').trim();
    const email = (regEmail?.value || '').trim();
    const pass  = regPass?.value || '';

    if (!name) { showStatus('Введите имя.', 'error'); return; }
    if (!email || !hasAtSymbol(email)) {
      showStatus('Email должен содержать "@".', 'error'); return;
    }
    if (!pass) { showStatus('Введите пароль.', 'error'); return; }

    const btn = findSubmitButton(formRegister);
    disableButton(btn, true);
    try {
      await apiPost('/api/auth/register', {
        name,
        email,
        password: pass,
      });

      showStatus('Регистрация успешна. Добро пожаловать!', 'success');

      clearForm(formRegister);

      if (email && loginEmail) loginEmail.value = email;
      setTimeout(() => setState('login'), 250);
    } catch (err) {
      showStatus(err?.message || 'Ошибка регистрации.', 'error');
    } finally {
      disableButton(btn, false);
    }
  });

  // Вход: /api/auth/login
  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');

    const email = (loginEmail?.value || '').trim();
    const pass  = loginPass?.value || '';

    if (!email || !hasAtSymbol(email)) {
      showStatus('Email должен содержать "@".', 'error'); return;
    }
    if (!pass) { showStatus('Введите пароль.', 'error'); return; }

    const btn = findSubmitButton(formLogin);
    disableButton(btn, true);
    try {
      await apiPost('/api/auth/login', { email, password: pass });

      showStatus('Вход выполнен. Добро пожаловать!', 'success');
      clearForm(formLogin);

      redirectToIndex();
    } catch (err) {
      showStatus(err?.message || 'Ошибка входа. Проверьте данные.', 'error');
    } finally {
      disableButton(btn, false);
    }
  });

  // Сброс пароля: /api/auth/reset
  formReset?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');
    showResetResult('');

    const email = (resetEmail?.value || '').trim();
    if (!email || !hasAtSymbol(email)) {
      showStatus('Email для сброса должен содержать "@".', 'error');
      return;
    }

    const btn = findSubmitButton(formReset);
    disableButton(btn, true);
    try {
      const data = await apiPost('/api/auth/reset', { email });
      const newPassword = data?.new_password;

      showStatus('Пароль сгенерирован. Смотрите ниже 👇', 'success');
      showResetResult(
        newPassword
          ? `Новый пароль: ${newPassword}`
          : 'Пароль обновлён. Используйте новый пароль для входа.'
      );

      clearForm(formReset);
    } catch (err) {
      showStatus(err?.message || 'Ошибка сброса пароля.', 'error');
    } finally {
      disableButton(btn, false);
    }
  });

  // Переключатели состояний
  qa('[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const action = el.getAttribute('data-action');
      if (action === 'to-login') setState('login');
      else if (action === 'to-reset') setState('reset');
      else if (action === 'to-register') setState('register');
    });
  });

  // Инициализация
  document.addEventListener('DOMContentLoaded', () => {
    setState('login');
    injectClearButton(formRegister);
    injectClearButton(formLogin);
    injectClearButton(formReset);
  });
})();
