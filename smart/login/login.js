// login.js — стабильная версия для SMART AUTH (PostgreSQL)

(function () {
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const formRegister = $('#form-register');
  const formLogin    = $('#form-login');
  const formReset    = $('#form-reset');

  const statusBox    = $('#login-status');
  const resetResult  = $('#reset-result');

  // ==========================
  // УТИЛИТЫ ДЛЯ СТАТУСА
  // ==========================
  function showStatus(text, type = 'info') {
    if (!statusBox) return;
    statusBox.textContent = text || '';
    statusBox.dataset.type = type; // стили можно повесить на [data-type="error"] и т.п.
  }

  function clearStatus() {
    showStatus('', 'info');
    if (resetResult) resetResult.textContent = '';
  }

  function showResetResult(text) {
    if (!resetResult) return;
    resetResult.textContent = text || '';
  }

  // Очистка всех инпутов в форме
  function clearFormFields(form) {
    if (!form) return;
    const inputs = form.querySelectorAll('input');
    inputs.forEach(inp => {
      if (inp.type === 'checkbox' || inp.type === 'radio') {
        inp.checked = false;
      } else {
        inp.value = '';
      }
    });
  }

  // ==========================
  // ПЕРЕКЛЮЧЕНИЕ ФОРМ
  // ==========================
  function switchTo(mode) {
    if (formRegister) formRegister.hidden = mode !== 'register';
    if (formLogin)    formLogin.hidden    = mode !== 'login';
    if (formReset)    formReset.hidden    = mode !== 'reset';

    // При переключении — чистим статус
    clearStatus();

    // Чистим поля ТОЛЬКО у той формы, в которую вошли
    if (mode === 'login')    clearFormFields(formLogin);
    if (mode === 'register') clearFormFields(formRegister);
    if (mode === 'reset')    clearFormFields(formReset);
  }

  // ==========================
  // УНИВЕРСАЛЬНЫЙ POST
  // ==========================
  async function apiPOST(path, body) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // Сетевая ошибка, сервер не доступен
      throw new Error('Сервер недоступен. Проверь соединение.');
    }

    let json = {};
    try {
      json = await res.json();
    } catch (_) {
      // если сервер вернул не-JSON
      json = {};
    }

    if (!res.ok) {
      // backend шлёт detail/error — отдаём юзеру
      const msg = json.detail || json.error || `Ошибка (${res.status})`;
      throw new Error(msg);
    }

    return json;
  }

  // ==========================
  // РЕГИСТРАЦИЯ
  // ==========================
  if (formRegister) {
    formRegister.addEventListener('submit', async e => {
      e.preventDefault();

      const btn = formRegister.querySelector('button[type="submit"]');
      const name  = $('#reg-name')?.value.trim()  || '';
      const email = $('#reg-email')?.value.trim() || '';
      const pass  = $('#reg-pass')?.value.trim()  || '';

      if (!name)  return showStatus('Введите имя', 'error');
      if (!email) return showStatus('Введите email', 'error');
      if (!pass)  return showStatus('Введите пароль', 'error');

      // Дополнительно нормализуем email (как на бэке)
      const emailNorm = email.toLowerCase();

      try {
        if (btn) btn.disabled = true;
        showStatus('Регистрируемся...', 'info');

        await apiPOST('/api/auth/register', {
          name,
          email: emailNorm,
          password: pass
        });

        showStatus('Регистрация успешна! Теперь войдите с этими данными.', 'success');

        // 👉 Больше НЕ подставляем email в логин — форма должна быть "чистой"
        switchTo('login');

      } catch (err) {
        showStatus(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ==========================
  // ВХОД
  // ==========================
  if (formLogin) {
    formLogin.addEventListener('submit', async e => {
      e.preventDefault();

      const btn = formLogin.querySelector('button[type="submit"]');
      const email = $('#login-email')?.value.trim() || '';
      const pass  = $('#login-pass')?.value.trim()  || '';

      if (!email) return showStatus('Введите email', 'error');
      if (!pass)  return showStatus('Введите пароль', 'error');

      const emailNorm = email.toLowerCase();

      try {
        if (btn) btn.disabled = true;
        showStatus('Входим...', 'info');

        await apiPOST('/api/auth/login', {
          email: emailNorm,
          password: pass
        });

        // При успешном входе — переходим на главную
        location.replace('/index.html');

      } catch (err) {
        showStatus(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ==========================
  // СБРОС ПАРОЛЯ
  // ==========================
  if (formReset) {
    formReset.addEventListener('submit', async e => {
      e.preventDefault();

      const btn = formReset.querySelector('button[type="submit"]');
      const email = $('#reset-email')?.value.trim() || '';

      if (!email) return showStatus('Введите email', 'error');

      const emailNorm = email.toLowerCase();

      try {
        if (btn) btn.disabled = true;
        showStatus('Сбрасываем пароль...', 'info');
        showResetResult('');

        const out = await apiPOST('/api/auth/reset', { email: emailNorm });

        const newPass = out.new_password || '—';
        showResetResult('Новый пароль: ' + newPass);
        showStatus('Пароль сброшен. Скопируйте новый пароль и войдите.', 'success');

      } catch (err) {
        showStatus(err.message, 'error');
        showResetResult('');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ==========================
  // ПЕРЕКЛЮЧАТЕЛИ
  // ==========================
  $$('[data-action]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = el.dataset.action.replace('to-', '');
      switchTo(mode);
    });
  });

  // ==========================
  // СТАРТОВОЕ СОСТОЯНИЕ
  // ==========================
  // Всегда начинаем с "чистого" логина
  switchTo('login');

})();
