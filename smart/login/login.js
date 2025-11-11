// /smart/login/login.js
// Реальный аутентификатор страницы (register / login / reset) поверх SVID API.
// Требование: после успешного сабмита поля очищаются; email подставляется во вход.
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

  // Переключатели состояний
  const switches = qa('[data-action]');

  // Состояния: register | login | reset
  let state = 'register';

  // --------- Утилиты ---------

  function hasAtSymbol(email) {
    return typeof email === 'string' && email.includes('@');
  }

  function showStatus(message, type = 'info') {
    if (!statusBox) return;
    statusBox.textContent = message || '';
    statusBox.dataset.type = type; // можно стилизовать [data-type="error|success|info"]
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

    // автофокус на первый инпут активной формы
    const activeForm =
      state === 'register' ? formRegister :
      state === 'login'    ? formLogin :
                             formReset;
    activeForm?.querySelector('input, select, textarea')?.focus();
  }

  // --------- Обработчики форм (ТЕПЕРЬ РЕАЛЬНЫЕ ВЫЗОВЫ SVID) ---------

  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');

    const name = (regName?.value || '').trim();
    const email = (regEmail?.value || '').trim();
    const pass = regPass?.value || '';

    if (!name) { showStatus('Введите имя.', 'error'); return; }
    if (!email || !hasAtSymbol(email)) { showStatus('Email должен содержать "@".', 'error'); return; }
    if (!pass) { showStatus('Введите пароль.', 'error'); return; }

    const btn = findSubmitButton(formRegister);
    disableButton(btn, true);
    try {
      // ВАЖНО: svid.js должен быть подключен раньше этого файла
      const data = await window.SVID.register({ name, email, password: pass });
      showStatus('Регистрация успешна. Добро пожаловать!', 'success');

      // очистка текущей формы
      clearForm(formRegister);

      // подставим email во вход и переключим окно
      if (email && loginEmail) loginEmail.value = email;
      setTimeout(() => setState('login'), 250);
    } catch (err) {
      showStatus(err?.message || 'Ошибка регистрации.', 'error');
    } finally {
      disableButton(btn, false);
    }
  });

  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');

    const email = (loginEmail?.value || '').trim();
    const pass  = loginPass?.value || '';

    if (!email || !hasAtSymbol(email)) { showStatus('Email должен содержать "@".', 'error'); return; }
    if (!pass) { showStatus('Введите пароль.', 'error'); return; }

    const btn = findSubmitButton(formLogin);
    disableButton(btn, true);
    try {
      const data = await window.SVID.login({ email, password: pass });
      showStatus('Вход выполнен. Добро пожаловать!', 'success');

      // очистка формы входа
      clearForm(formLogin);

      // тут можно редиректнуть, если хочешь:
      // location.href = '/smart/index.html';
    } catch (err) {
      showStatus(err?.message || 'Ошибка входа. Проверьте данные.', 'error');
    } finally {
      disableButton(btn, false);
    }
  });

  formReset?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');
    showResetResult('');

    const email = (resetEmail?.value || '').trim();
    if (!email || !hasAtSymbol(email)) { showStatus('Email для сброса должен содержать "@".', 'error'); return; }

    const btn = findSubmitButton(formReset);
    disableButton(btn, true);
    try {
      const { new_password } = await window.SVID.resetPassword({ email });
      showStatus('Пароль сгенерирован. Смотрите ниже 👇', 'success');
      showResetResult(new_password ? `Новый пароль: ${new_password}` : 'Инструкция отправлена на почту.');

      // очистка формы сброса
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
    setState('register');
    injectClearButton(formRegister);
    injectClearButton(formLogin);
    injectClearButton(formReset);
  });
})();
