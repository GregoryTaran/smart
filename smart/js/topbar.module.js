// /smart/js/topbar.module.js — FIXED FULL VERSION (logout works everywhere)

const AUTH_CACHE_KEY = 'sv.auth.cache.v1';

function getAuthState() {
  if (window.SV_AUTH && typeof window.SV_AUTH === 'object') return window.SV_AUTH;
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

function clearAuthCache() {
  try { localStorage.removeItem(AUTH_CACHE_KEY); } catch (e) {}
}

function redirectToIndex() {
  try {
    location.replace(new URL('index.html', document.baseURI).href);
  } catch (e) {
    location.replace('index.html');
  }
}

// ====================== LOGOUT (FULL FIX) ============================
async function logoutRequest() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch {}

  clearAuthCache();

  // Обновляем локальное состояние
  window.SV_AUTH = {
    isAuthenticated: false,
    userId: null,
    level: 1,
    levelCode: 'guest',
    email: null,
    displayName: null,
    loaded: true
  };

  // UI обновить
  syncAuthLink(1);
  renderMenu(1);
  highlightActive();

  // Закрыть меню, если открыто
  closeMenu();

  redirectToIndex();
}

// ====================== MENU SYSTEM ============================
const MENU = [
  { id: 'home', title: 'Главная', href: 'index.html', allow: [1, 2] },
  { id: 'about', title: 'О проекте', href: 'about/about.html', allow: [1, 2] },
  { id: 'priv', title: 'Политика конфиденциальности', href: 'privacy/privacy.html', allow: [1, 2] },
  { id: 'terms', title: 'Условия использования', href: 'terms/terms.html', allow: [1, 2] },

  { id: 'login', title: 'Вход/регистрация', href: 'login/login.html#login', allow: [1] },

  { id: 'ts', title: 'Проверка сервера', href: 'testserver/testserver.html', allow: [2] },
  { id: 'rec', title: 'Диктофон', href: 'voicerecorder/voicerecorder.html', allow: [2] },
  { id: 'vision', title: 'Путь по визии', href: 'vision/index.html', allow: [2] },

  { id: 'app', title: 'Мобильное приложение', href: 'app/app.html', allow: [1, 2] },

  { id: 'logout', title: 'Выйти', href: '#logout', action: 'logout', allow: [2] }
];

// ====================== RENDER MENU ============================
function renderMenu(level = getLevel()) {
  const host = document.querySelector('[data-svid-menu]');
  if (!host) return;

  const items = MENU.filter(i => i.allow.includes(level));

  host.innerHTML = `<ul>${
    items
      .map(i =>
        `<li>
          <a href="${i.href}" 
             data-id="${i.id}" 
             ${i.action ? `data-action="${i.action}"` : ""}>
             ${i.title}
          </a>
        </li>`
      )
      .join("")
  }</ul>`;

  // ACTIONS
  host.querySelectorAll('[data-action="logout"]').forEach(a => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      await logoutRequest();
    });
  });
}

// ====================== ACTIVE LINK ============================
function highlightActive() {
  let currentPath = location.pathname.toLowerCase();
  if (currentPath === '/') currentPath = '/index.html';

  document.querySelectorAll('[data-svid-menu] a[href]').forEach(a => {
    const rawHref = a.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#')) {
      a.classList.remove('is-active');
      return;
    }

    let hrefPath;
    try {
      hrefPath = new URL(rawHref, window.location.origin).pathname.toLowerCase();
    } catch {
      hrefPath = rawHref.toLowerCase();
    }

    if (hrefPath === '/') hrefPath = '/index.html';

    a.classList.toggle('is-active', currentPath === hrefPath);
  });
}

// ====================== TOPBAR ============================
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

function bindAuthLink() {
  const a = document.getElementById('auth-link');
  if (!a) return;

  a.addEventListener('click', async (e) => {
    if (getLevel() >= 2) {
      e.preventDefault();
      await logoutRequest();
    }
  });
}

function syncAuthLink(level) {
  let a = document.getElementById('auth-link');
  if (!a) return;

  if (level >= 2) {
    a.textContent = 'Выйти';
    a.href = '#logout';
    a.setAttribute('data-action', 'logout');
    a.classList.add('login-link--active');   // 🟦 <— добавляем класс при логине
  } else {
    a.textContent = 'Логин';
    a.href = 'login/login.html#login';
    a.removeAttribute('data-action');
    a.classList.remove('login-link--active'); // убираем класс при выходе
  }
}


// ====================== MENU CONTROLS ============================
function toggleMenu() {
  const body = document.body;
  const overlay = document.querySelector('#overlay');
  const btn = document.querySelector('#topbar .menu-toggle');

  const opened = !body.classList.contains('menu-open');
  body.classList.toggle('menu-open', opened);

  btn?.setAttribute('aria-expanded', opened ? 'true' : 'false');
  if (overlay) overlay.hidden = !opened;
}

function closeMenu() {
  const body = document.body;
  if (!body.classList.contains('menu-open')) return;

  const overlay = document.querySelector('#overlay');
  const btn = document.querySelector('#topbar .menu-toggle');

  body.classList.remove('menu-open');
  btn?.setAttribute('aria-expanded', 'false');
  if (overlay) overlay.hidden = true;
}

function initMenuControls() {
  document.querySelector('#overlay')?.addEventListener('click', closeMenu);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('popstate', closeMenu);
}

// ====================== INIT PAGE ============================
export async function initPage({
  fragments = [['menu.html', '#sidebar']],
  cacheBust = false,
  topbar = { state: { logoHref: 'index.html', logoSrc: 'assets/logo400.jpg' } }
} = {}) {

  renderTopbar(topbar.state);

  // Поддержка URL #logout
  if (location.hash === '#logout') {
    await logoutRequest();
    return;
  }

  for (const [url, sel] of fragments) {
    await loadFragment(cacheBust ? `${url}?_=${Date.now()}` : url, sel);
  }

  initMenuControls();

  const lvl = getLevel();
  syncAuthLink(lvl);
  renderMenu(lvl);
  highlightActive();

  document.addEventListener('sv:auth-ready', (e) => {
    const newLevel = Number(e?.detail?.level) || 1;
    syncAuthLink(newLevel);
    renderMenu(newLevel);
    highlightActive();
  });

  window.addEventListener('pageshow', () => {
    const cur = getLevel();
    syncAuthLink(cur);
    renderMenu(cur);
    highlightActive();
  });
}

// ====================== FRAGMENT LOADER ============================
async function loadFragment(url, sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  const html = await (await fetch(url, { cache: 'no-cache' })).text();
  el.innerHTML = html;
}
