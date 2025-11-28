// ===========================================================
// TOPBAR + MENU (SmartID Edition)
// Чистая версия: никакого SV_AUTH, событий, кэшей
// Работает только на основе session, которую даёт SmartID
// ===========================================================

// --------------------------- MENU DATA ---------------------
export const MENU = [
  { id: 'home',   title: 'Главная', href: 'index.html', allow: [1, 2] },
  { id: 'about',  title: 'О проекте', href: 'about/about.html', allow: [1, 2] },
  { id: 'priv',   title: 'Политика', href: 'privacy/privacy.html', allow: [1, 2] },
  { id: 'terms',  title: 'Условия', href: 'terms/terms.html', allow: [1, 2] },

  { id: 'login',  title: 'Вход/регистрация', href: 'login/login.html#login', allow: [1] },

  { id: 'ts',     title: 'Проверка сервера', href: 'testserver/testserver.html', allow: [2] },
  { id: 'rec',    title: 'Диктофон', href: 'voicerecorder/voicerecorder.html', allow: [2] },
  { id: 'vision', title: 'Путь по визии', href: 'vision/index.html', allow: [2] },

  { id: 'app',    title: 'Мобильное приложение', href: 'app/app.html', allow: [1, 2] },

  { id: 'logout', title: 'Выйти', href: '#logout', action: 'logout', allow: [2] }
];

// ===========================================================
// TOPBAR
// ===========================================================
export function renderTopbar(session) {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;

  const logoHref = 'index.html';
  const logoSrc  = 'assets/logo400.jpg';

  topbar.innerHTML = `
    <div class="topbar-inner">
      <button class="menu-toggle" aria-controls="sidebar" aria-expanded="false">☰</button>

      <a class="logo" href="${logoHref}">
        <img src="${logoSrc}" alt="SMART VISION" />
      </a>

      <a id="auth-link" class="login-link"></a>
    </div>
  `;

  topbar.querySelector('.menu-toggle')?.addEventListener('click', toggleMenu);

  syncAuthLink(session);
}

// ===========================================================
// AUTH LINK (войти/выйти)
// ===========================================================
function syncAuthLink(session) {
  const a = document.getElementById('auth-link');
  if (!a) return;

  if (session.authenticated) {
    a.textContent = 'Выйти';
    a.href = '#logout';
    a.onclick = async (e) => {
      e.preventDefault();
      await logout();
    };
  } else {
    a.textContent = 'Войти';
    a.href = 'login/login.html#login';
    a.removeAttribute('data-action');
  }
}

// ===========================================================
// MENU RENDER
// ===========================================================
export function renderMenu(level) {
  const host = document.querySelector('[data-svid-menu], #sidebar nav, #sidebar');
  if (!host) return;

  const items = MENU.filter(i => i.allow.includes(level));

  host.innerHTML = `
    <nav class="menu" data-svid-menu>
      <ul>
        ${items.map(i => `
          <li>
            <a href="${i.href}" data-id="${i.id}" ${i.action ? `data-action="${i.action}"` : ''}>
              ${i.title}
            </a>
          </li>
        `).join('')}
      </ul>
    </nav>
  `;

  // logout handler
  host.querySelectorAll('[data-action="logout"]').forEach(a => {
    a.onclick = async (e) => {
      e.preventDefault();
      await logout();
    };
  });

  highlightActive();
}

// ===========================================================
// LOGOUT (SmartID)
// ===========================================================
async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (e) {
    console.warn('Logout error:', e);
  }

  // После logout страница перезагружается
  location.href = 'index.html';
}

// ===========================================================
// MENU HIGHLIGHT
// ===========================================================
export function highlightActive() {
  let currentPath = location.pathname.toLowerCase();
  if (currentPath === '/') currentPath = '/index.html';

  document.querySelectorAll('[data-svid-menu] a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    let hrefPath;

    try {
      hrefPath = new URL(href, window.location.origin).pathname.toLowerCase();
    } catch {
      hrefPath = href.toLowerCase();
    }

    if (hrefPath === '/') hrefPath = '/index.html';

    a.classList.toggle('is-active', hrefPath === currentPath);
  });
}

// ===========================================================
// MENU CONTROLS
// ===========================================================
function toggleMenu() {
  document.body.classList.toggle('menu-open');
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.hidden = !document.body.classList.contains('menu-open');
}
