document.addEventListener('DOMContentLoaded', () => {
  const formLogin = document.getElementById('login-form');
  const formReg   = document.getElementById('register-form');
  const statusLogin = document.getElementById('login-status');
  const statusReg   = document.getElementById('register-status');
  const btnSignup = document.getElementById('signup-btn');

  const setStatus = (el, t) => el && (el.textContent = t || '');

  function show(mode) {
    const isLogin = mode !== 'register';
    formLogin?.classList.toggle('hidden', !isLogin);
    formReg?.classList.toggle('hidden', isLogin);
    (isLogin ? formLogin : formReg)?.querySelector('input')?.focus();
  }
  function currentMode() {
    const h = (location.hash || '').slice(1).toLowerCase();
    return h === 'register' ? 'register' : 'login';
  }
  window.addEventListener('hashchange', () => show(currentMode()));
  if (!location.hash) location.hash = '#login';
  show(currentMode());

  // «Создать аккаунт» -> показываем форму регистрации
  btnSignup?.addEventListener('click', () => { location.hash = '#register'; });

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.detail || data?.message || 'Ошибка сервера');
    return data;
  }

  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = /** @type {HTMLInputElement} */(document.getElementById('email'))?.value?.trim();
    const password = /** @type {HTMLInputElement} */(document.getElementById('password'))?.value;
    if (!email || !password) { setStatus(statusLogin, 'Введите email и пароль'); return; }
    setStatus(statusLogin, 'Входим…');
    try {
      const { redirect } = await postJSON('/api/auth/login', { email, password });
      window.location.assign(redirect || '/');
    } catch (e) {
      setStatus(statusLogin, e.message);
    }
  });

  formReg?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = /** @type {HTMLInputElement} */(document.getElementById('reg-name'))?.value?.trim();
    const email = /** @type {HTMLInputElement} */(document.getElementById('reg-email'))?.value?.trim();
    const password = /** @type {HTMLInputElement} */(document.getElementById('reg-password'))?.value;
    if (!name || !email || !password) { setStatus(statusReg, 'Заполните все поля'); return; }
    setStatus(statusReg, 'Регистрируем…');
    try {
      const { redirect } = await postJSON('/api/auth/register', { name, email, password });
      window.location.assign(redirect || '/');
    } catch (e) {
      setStatus(statusReg, e.message);
    }
  });
});
