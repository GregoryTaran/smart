/* smart/login/login.js — обновлённый минималистичный логин
   Что добавлено:
   - Жёсткий редирект на /smart/index.html после УСПЕШНОГО входа
   - Нормальные сообщения ошибок (в т.ч. для reset: "Такого пользователя нет")
   - Показ dev-пароля при /reset, если бэкенд вернул { new_password }
*/

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // Контейнеры статусов (по месту — подставь свои селекторы при необходимости)
  const boxStatus = $('#status');
  const boxResetResult = $('#reset-result');

  function showStatus(text, kind = 'info') {
    if (!boxStatus) return;
    boxStatus.textContent = text || '';
    boxStatus.dataset.kind = kind; // можно стилизовать через [data-kind]
  }

  function showResetResult(html) {
    if (!boxResetResult) return;
    boxResetResult.innerHTML = html || '';
  }

  // ===== LOGIN =====
  const formLogin = $('#form-login');
  const inpLoginEmail = $('#login-email');
  const inpLoginPass = $('#login-password');

  on(formLogin, 'submit', async (e) => {
    e.preventDefault();
    const email = (inpLoginEmail?.value || '').trim();
    const password = inpLoginPass?.value || '';

    if (!email || !email.includes('@')) {
      showStatus('Введите корректный e-mail.', 'error');
      return;
    }
    if (!password) {
      showStatus('Введите пароль.', 'error');
      return;
    }

    showStatus('Входим…');
    try {
      await window.SVID.login({ email, password });
      // УСПЕХ → жёсткий переход на индекс, чтобы меню/уровни обновились
      window.location.replace('./index.html');
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('invalid credentials')) {
        showStatus('Неверная почта или пароль.', 'error');
      } else {
        showStatus(err?.message || 'Не удалось войти.', 'error');
      }
    }
  });

  // ===== REGISTER (оставляем без редиректа по задаче; можно включить при желании) =====
  const formReg = $('#form-register');
  const inpRegName = $('#reg-name');
  const inpRegEmail = $('#reg-email');
  const inpRegPass = $('#reg-password');

  on(formReg, 'submit', async (e) => {
    e.preventDefault();
    const display_name = (inpRegName?.value || '').trim();
    const email = (inpRegEmail?.value || '').trim();
    const password = inpRegPass?.value || '';

    if (!email || !email.includes('@')) {
      showStatus('Введите корректный e-mail.', 'error');
      return;
    }
    if (!password || password.length < 6) {
      showStatus('Пароль должен быть не короче 6 символов.', 'error');
      return;
    }

    showStatus('Регистрируем…');
    try {
      await window.SVID.register({ display_name, email, password });
      showStatus('Готово! Теперь войдите под своими данными.', 'success');
      // Очистим поля и подставим e-mail во вход (если у тебя так задумано)
      if (inpLoginEmail) inpLoginEmail.value = email;
      if (formReg) formReg.reset();
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('already exists')) {
        showStatus('Такой пользователь уже существует.', 'error');
      } else {
        showStatus(err?.message || 'Не удалось зарегистрироваться.', 'error');
      }
    }
  });

  // ===== RESET =====
  const formReset = $('#form-reset');
  const inpResetEmail = $('#reset-email');

  on(formReset, 'submit', async (e) => {
    e.preventDefault();
    const email = (inpResetEmail?.value || '').trim();
    if (!email || !email.includes('@')) {
      showStatus('Введите корректный e-mail.', 'error');
      return;
    }

    showStatus('Сбрасываем пароль…');
    showResetResult('');
    try {
      const res = await window.SVID.reset({ email });
      if (res && res.new_password) {
        showStatus('Пароль сгенерирован. Смотрите ниже 👇', 'success');
        showResetResult(`<div class="pwd-box">Новый пароль: <b>${res.new_password}</b></div>`);
      } else {
        // Бэкенд мог вернуть ok:true без new_password (если прислали свой password в запросе)
        showStatus('Пароль обновлён.', 'success');
      }
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('user not found')) {
        showStatus('Такого пользователя нет.', 'error');
        showResetResult('');
      } else {
        showStatus(err?.message || 'Ошибка сброса пароля.', 'error');
      }
    }
  });
})();
