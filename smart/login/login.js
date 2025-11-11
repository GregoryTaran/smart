// /smart/login/login.js
// Минимальный аутентификатор: register / login / reset
// Требование: после УСПЕШНОГО сабмита поля формы очищаются.
// Плюс добавлены кнопки "Очистить поля" на каждую форму.
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
    statusBox.dataset.type = type; // стилизуем через [data-type]
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

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // Очистка полей формы
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

  // Впрыскиваем кнопку "Очистить поля" в каждую форму
  function injectClearButton(form) {
    if (!form) return;
    // Ищем контейнер ссылок, если есть — добавляем туда; иначе в конец формы
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

    // Сброс локальных сообщений при смене состояния
    showStatus('');
    showResetResult('');

    // Автофокус на первый инпут активной формы — ощущение “окна”
    const activeForm =
      state === 'register' ? formRegister :
      state === 'login'    ? formLogin :
                             formReset;

    const firstInput = activeForm?.querySelector('input, select, textarea');
    firstInput?.focus();
  }

  // --------- Обработчики форм (пока моки без бэкенда) ---------

  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showStatus('');

    const name = (regName?.value || '').trim();
    const email = (regEmail?.value || '').trim();
    const pass = regPass?.value || '';

    // Простейшая проверка по ТЗ
    if (!name) { showStatus('Введите имя.', 'error'); return; }
    if (!email || !hasAtSymbol(email)) { showStatus('Email должен содержать "@".', 'error'); return; }
    if (!pass) { showStatus('Введите пароль.', 'error'); return; }

    const btn = findSubmitButton(formRegister);
    disableButton(btn, true);
    try {
      // TODO: реальный вызов /api/svid/register
      // const res = await fetch('/api/svid/register', { ... });
      // const data = await res.json();

      // Мок-успех:
      showStatus('Регистрация успешна (мок). Теперь можно войти.', 'success');

      // ОЧИСТКА текущей формы после успеха
      clearForm(formRegister);

      // Подставим email во вход (как удобный автозаполнитель)
      if (email && loginEmail) loginEmail.value = email;

      dispatch('svid:registered', { name, email });

      // Автопереход во "Вход"
      setTimeout(() => setState('login'), 300);
    } catch (err) {
      showStatus('Ошибка регистрации. Попробуйте позже.', 'error');
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
      // TODO: реальный вызов /api/svid/login
      // const res = await fetch('/api/svid/login', { ... });
      // const data = await res.json();

      // Мок-успех:
      showStatus('Вход выполнен (мок). Добро пожаловать!', 'success');

      // ОЧИСТКА текущей формы после успеха
      clearForm(formLogin);

      dispatch('svid:login', { email });
      // при необходимости: location.href = '/smart/index.html';
    } catch (err) {
      showStatus('Ошибка входа. Проверьте данные.', 'error');
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
      // TODO: реальный вызов /api/svid/reset -> сервер генерирует пароль и возвращает его
      // const res = await fetch('/api/svid/reset', { ... });
      // const { new_password } = await res.json();

      // Мок: сгенерируем пароль локально
      const new_password = generatePassword(10);
      showStatus('Пароль сгенерирован (мок). Смотрите ниже 👇', 'success');
      showResetResult(`Новый пароль: ${new_password}`);

      // ОЧИСТКА текущей формы после успеха
      clearForm(formReset);

      dispatch('svid:password_reset', { email, password: new_password });
    } catch (err) {
      showStatus('Ошибка сброса пароля. Попробуйте позже.', 'error');
    } finally {
      disableButton(btn, false);
    }
  });

  // Генерация простого пароля (мок)
  function generatePassword(length = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^*';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  // Переключатели состояний
  switches.forEach((el) => {
    el.addEventListener('click', () => {
      const action = el.getAttribute('data-action');
      if (action === 'to-login') setState('login');
      else if (action === 'to-reset') setState('reset');
      else if (action === 'to-register') setState('register');
    });
  });

  // Инициализация
  document.addEventListener('DOMContentLoaded', () => {
    // По умолчанию показываем регистрацию
    setState('register');

    // Впрыснем кнопки "Очистить поля" во все формы
    injectClearButton(formRegister);
    injectClearButton(formLogin);
    injectClearButton(formReset);

    // На всякий: лог загрузки
    // console.log('[SVID] login.js ready');
  });
})();
