// === Global redirect to index after logout (respects <base>) ===
function redirectToIndex() {
  try {
    const url = new URL('index.html', document.baseURI).href;
    location.replace(url);
  } catch (e) {
    location.replace('index.html');
  }
}
// === /redirect helper ===

const AUTH_CACHE_KEY = 'sv.auth.cache.v1';

function clearAuthCache() {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch (e) {
    console.warn('clearAuthCache failed', e);
  }
}

/* topbar.module.js — версия под новую авторизацию
   БЭКЕНД: /api/auth/session (читаем в <head>), /api/auth/logout (здесь вызываем)
   ФРОНТ: читает window.SV_AUTH и слушает событие document 'sv:auth-ready'
*/

const MENU = [
  { id: 'home',  title: 'Главная',                     href: 'index.html',                       allow: [1, 2] },
  { id: 'about', title: 'О проекте',                   href: 'about/about.html',                 allow: [1, 2] },
  { id: 'priv',  title: 'Политика конфиденциальности', href: 'privacy/privacy.html',             allow: [1, 2] },
  { id: 'terms', title: 'Условия использования',       href: 'terms/terms.html',                 allow: [1, 2] },

  { id: 'login', title: 'Вход/регистрация',            href: 'login/login.html',                 allow: [1] },

  { id: 'ts',    title: 'Проверка сервера',            href: 'testserver/testserver.html',       allow: [2] },
  { id: 'rec',   title: 'Диктофон',                    href: 'voicerecorder/voicerecorder.html', allow: [2] },
  { id: 'vision',   title: 'Путь по визии',            href: 'vision/index.html',               allow: [2] },
  { id: 'app',   title: 'Мобильное приложение',        href: 'app/app.html',                     allow: [1, 2] },
  { id: 'logout',title: 'Выйти',                       href: '#logout', action: 'logout',        allow: [2] },
];

/* === Утилиты для чтения авторизации из window.SV_AUTH === */

function getAuthState() {
  // Структура, которую заполняет скрипт в <head>
  if (window.SV_AUTH && typeof window.SV_AUTH === 'object') {
    return window.SV_AUTH;
  }
  return {
    isAuthenticated: false,
    userId: null,
    level: 1,
    levelCode: 'guest',
    email: null,
    displayName: null,
    loaded: false,
  };
}

function getLevel() {
  const auth = getAuthState();
  const lvl = Number(auth.level);
  return Number.isFinite(lvl) && lvl > 0 ? lvl : 1;
}

/* === Диагностический бейдж уровня (низ справа) === */
function ensureLevelDebugBadge(levelValue = getLevel()) {
  let el = document.getElementById('svid-level-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'svid-level-badge';
    el.style.cssText = [
      'position:fixed','right:12px','bottom:12px','z-index:2147483647',
      'padding:6px 10px','border-radius:8px','background:rgba(0,0,0,.75)',
      'color:#fff','font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 2px 6px rgba(0,0,0,.3)','pointer-events:none','user-select:none'
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = `level ${levelValue}`;
}
/* === /бейдж === */

function toggleMenu() {
  const body = document.body;
  const overlay = document.querySelector('#overlay');
  const btn = document.querySelector('#topbar .menu-toggle');

  const opened = !body.classList.contains('menu-open');
  body.classList.toggle('menu-open', opened);
  btn?.setAttribute('aria-expanded', opened ? 'true' : 'false');
  if (overlay) overlay.hidden = !opened;

  if (opened) {
    body.dataset.prevOverflow = body.style.overflow || '';
    body.style.overflow = 'hidden';
  } else {
    body.style.overflow = body.dataset.prevOverflow || '';
    delete body.dataset.prevOverflow;
  }
}

function closeMenu() {
  const body = document.body;
  if (!body.classList.contains('menu-open')) return;
  const overlay = document.querySelector('#overlay');
  const btn = document.querySelector('#topbar .menu-toggle');
  body.classList.remove('menu-open');
  btn?.setAttribute('aria-expanded', 'false');
  if (overlay) overlay.hidden = true;
  body.style.overflow = body.dataset.prevOverflow || '';
  delete body.dataset.prevOverflow;
}

function initMenuControls() {
  document.querySelector('#overlay')?.addEventListener('click', closeMenu);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('popstate', closeMenu);
  document.querySelector('#sidebar')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) closeMenu();
  });
}

/* === Логин/Логаут в правом верхнем углу === */

async function logoutRequest() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (e) {
    console.warn('Logout request failed', e);
  } finally {
    // Чистим клиентский кэш и оповещаем всех слушателей
    clearAuthCache();
    window.dispatchEvent(new Event('sv:logout'));
  }
}

function bindAuthLink() {
  const a = document.getElementById('auth-link');
  if (!a) return;
  a.addEventListener('click', async (e) => {
    const lvl = getLevel();
    if (lvl >= 2) {
      // Залогинен → это кнопка "Выйти"
      e.preventDefault();
      await logoutRequest();
    }
    // если не залогинен — обычный переход на страницу логина
  });
}

function syncAuthLink(lvl) {
  let a = document.getElementById('auth-link');
  if (!a) {
    // Подождём появления topbar в DOM
    setTimeout(() => syncAuthLink(lvl), 50);
    return;
  }

  if (lvl >= 2) {
    // LOGGED IN -> show Logout (blue filled)
    a.textContent = 'Выйти';
    a.setAttribute('href', '#logout');
    a.setAttribute('data-action', 'logout');
    a.classList.add('is-logout');

    a.style.background = '#007bff';
    a.style.color = '#fff';
    a.style.border = 'none';
    a.style.borderRadius = '8px';
    a.style.fontWeight = '700';
    a.style.padding = '6px 12px';
    a.style.transition = 'background 0.2s ease';
    a.onmouseover = () => (a.style.background = '#0056b3');
    a.onmouseout  = () => (a.style.background = '#007bff');

  } else {
    // NOT LOGGED IN -> show Login
    a.textContent = 'Логин';
    a.setAttribute('href', 'login/login.html#login');
    a.removeAttribute('data-action');
    a.classList.remove('is-logout');

    a.style.background = '#fff';
    a.style.color = '#000';
    a.style.border = '2px solid #333';
    a.style.borderRadius = '8px';
    a.style.fontWeight = '600';
    a.style.padding = '6px 12px';
    a.style.transition = 'none';
    a.onmouseover = a.onmouseout = null;
  }
}

/* === Меню слева === */

function renderMenu(currentLevel = getLevel()) {
  const host = document.querySelector('[data-svid-menu]');
  if (!host) return;
  const items = MENU.filter(i => i.allow.includes(currentLevel));
  host.innerHTML = `<ul>${
    items.map(i =>
      `<li><a href="${i.href}" data-id="${i.id}" ${i.action ? `data-action="${i.action}"` : ''}>${i.title}</a></li>`
    ).join('')
  }</ul>`;

  (host.querySelectorAll?.('[data-action="logout"]') || []).forEach(a => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      await logoutRequest();
    });
  });
}

function highlightActive() {
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const pageId = page.replace(/\.html$/, '') || 'index';
  document.querySelectorAll('[data-svid-menu] a').forEach(a => {
    const id = (a.getAttribute('data-id') || '').toLowerCase();
    const href = (a.getAttribute('href') || '').toLowerCase();
    const ok = (id && id === pageId) ||
               href.endsWith(`${pageId}.html`) ||
               (pageId === 'index' && (href === '' || href.endsWith('index.html')));
    a.classList.toggle('is-active', ok);
  });
}

async function loadFragment(url, sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  const html = await (await fetch(url, { cache: 'no-cache' })).text();
  el.innerHTML = html;
}

/* === Рендер топбара === */

function renderTopbar(state = {}) {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;

  const logoHref = state.logoHref || 'index.html';
  const logoSrc  = state.logoSrc  || 'assets/logo400.jpg';

  topbar.innerHTML = `
    <div class="topbar-inner">
      <button class="menu-toggle" aria-controls="sidebar" aria-expanded="false" aria-label="Открыть меню">☰</button>
      <a class="logo" href="${logoHref}">
        <img src="${logoSrc}" alt="SMART VISION" />
      </a>
      <a id="auth-link" class="login-link" href="login/login.html#login">Логин</a>
    </div>
  `;

  topbar.querySelector('.menu-toggle')?.addEventListener('click', toggleMenu);
  bindAuthLink();
  syncAuthLink(getLevel());
}

/* === Главная инициализация страницы === */

export async function initPage({
  fragments = [['menu.html', '#sidebar']],
  cacheBust = false,
  topbar = { state: { logoHref: 'index.html', logoSrc: 'assets/logo400.jpg' } }
} = {}) {
  renderTopbar(topbar.state);

  for (const [url, sel] of fragments) {
    await loadFragment(cacheBust ? `${url}?_=${Date.now()}` : url, sel);
  }

  initMenuControls();

  // 1) Попробуем сразу взять текущий уровень (если SV_AUTH уже загружен)
  let lvl = getLevel();
  syncAuthLink(lvl);
  renderMenu(lvl);
  highlightActive();
  ensureLevelDebugBadge(lvl);

  // 2) Подписываемся на событие, которое кидает скрипт в <head>, когда /api/auth/session ответил
  document.addEventListener('sv:auth-ready', (event) => {
    const detail = event?.detail || getAuthState();
    const newLevel = Number(detail.level) || 1;
    syncAuthLink(newLevel);
    renderMenu(newLevel);
    highlightActive();
    ensureLevelDebugBadge(newLevel);
  });

  // 3) На всякий случай при возвращении из bfcache — обновим бейдж и меню
  window.addEventListener('pageshow', () => {
    const cur = getLevel();
    syncAuthLink(cur);
    renderMenu(cur);
    highlightActive();
    ensureLevelDebugBadge(cur);
  });
}

// Если где-то в коде ты сам вызовешь logout и кинешь это событие
window.addEventListener('sv:logout', () => {
  clearAuthCache();
  redirectToIndex();
});

// Опционально: если другая вкладка удалила кэш авторизации — реагируем
window.addEventListener('storage', (e) => {
  if (e.key === AUTH_CACHE_KEY && e.newValue === null) {
    redirectToIndex();
  }
});
