// /js/topbar.module.js
// Делает всё: грузит фрагменты (меню/футер), рисует топ-бар, управляет меню, подсвечивает активный пункт.

//// ==================== Утилиты фрагментов ====================

export async function loadFragment(url, targetSelector, { cacheBust = false } = {}) {
  const target = document.querySelector(targetSelector);
  if (!target) return;

  const src = cacheBust ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}` : url;

  try {
    const resp = await fetch(src, { credentials: "same-origin", cache: "no-cache" });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    target.innerHTML = await resp.text();
  } catch (err) {
    console.warn(`[loadFragment] ${url} -> ${targetSelector} failed`, err);
    target.innerHTML = `<div class="fragment-error" role="status">Не удалось загрузить ${url}</div>`;
  }
}

export async function loadFragments(jobs = [], opts = {}) {
  await Promise.all(jobs.map(([url, sel]) => loadFragment(url, sel, opts)));
}

//// ==================== Топ-бар ====================

export function renderTopbar(targetEl, state = {}, handlers = {}) {
  if (!targetEl) return;

  const {
    logoHref = "index.html",
    logoSrc  = "assets/logo400.jpg",
    auth     = { user: null },  // user: {id,name} если залогинен
  } = state;

  const isAuth = !!auth?.user;

  targetEl.innerHTML = `
    <div class="topbar-inner">
      <button class="menu-toggle"
              aria-controls="sidebar"
              aria-expanded="false"
              aria-label="Открыть меню">☰</button>

      <a class="logo" href="${logoHref}">
        <img src="${logoSrc}" alt="SMART VISION" />
      </a>

      <a id="auth-link" class="login-link" href="${isAuth ? '#logout' : 'login/login.html#login'}">
        ${isAuth ? 'Выйти' : 'Логин'}
      </a>
    </div>
  `;

  // Внутренние хендлеры + прокидываем наружу
  const btn = targetEl.querySelector('.menu-toggle');
  btn?.addEventListener('click', () => handlers.onToggleMenu?.());

  const aAuth = targetEl.querySelector('#auth-link');
  aAuth?.addEventListener('click', (e) => {
    if (isAuth) { e.preventDefault(); handlers.onLogout?.(); }
    else { handlers.onLoginClick?.(); }
  });
}

export function updateTopbar(targetEl, patch = {}) {
  if (!targetEl) return;

  if (Object.prototype.hasOwnProperty.call(patch, 'auth')) {
    const isAuth = !!patch.auth?.user;
    const link = targetEl.querySelector('#auth-link');
    if (link) {
      link.textContent = isAuth ? 'Выйти' : 'Логин';
      link.setAttribute('href', isAuth ? '#logout' : 'login/login.html#login');
    }
  }
  if (patch.logoHref) {
    const a = targetEl.querySelector('.logo');
    if (a) a.setAttribute('href', patch.logoHref);
  }
  if (patch.logoSrc) {
    const img = targetEl.querySelector('.logo img');
    if (img) img.setAttribute('src', patch.logoSrc);
  }
}

//// ==================== Меню (открытие/закрытие, overlay, Escape, popstate) ====================

function qs(sel) { return document.querySelector(sel); }

export function openMenu() {
  const body = document.body;
  const overlay = qs('#overlay');
  const btn = qs('#topbar .menu-toggle');
  body.classList.add('menu-open');
  btn?.setAttribute('aria-expanded', 'true');
  if (overlay) overlay.hidden = false;
}

export function closeMenu() {
  const body = document.body;
  const overlay = qs('#overlay');
  const btn = qs('#topbar .menu-toggle');
  body.classList.remove('menu-open');
  btn?.setAttribute('aria-expanded', 'false');
  if (overlay) overlay.hidden = true;
}

export function initMenuControls() {
  const overlay = qs('#overlay');
  const btn = qs('#topbar .menu-toggle');

  // Кнопка в топбаре уже вешает onToggleMenu наружу. На случай прямой инициализации:
  btn?.addEventListener('click', () => openMenu());

  overlay?.addEventListener('click', () => closeMenu());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  window.addEventListener('popstate', () => closeMenu());
}

//// ==================== Подсветка активного пункта меню ====================

export function highlightActiveMenuItem() {
  // index.html -> "index"
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const pageId = path.replace(/\.html$/, '');
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const links = sidebar.querySelectorAll('a[data-id]');
  links.forEach((a) => {
    const id = (a.getAttribute('data-id') || '').toLowerCase();
    if (id === pageId) a.classList.add('is-active');
  });
}

//// ==================== Единая инициализация страницы ====================
// 1) грузим меню/футер, 2) рендерим топ-бар, 3) включаем меню и подсветку.

export async function initPage({
  fragments = [
    ["menu.html",   "#sidebar"],
    ["footer.html", "#footer"],
  ],
  cacheBust = false,
  topbar = {
    state:   { logoHref: "index.html", logoSrc: "assets/logo400.jpg", auth: { user: null } },
    handlers: {
      onToggleMenu: () => openMenu(),
      onLoginClick: () => console.log('login clicked'),
      onLogout: () => {
        console.log('logout clicked');
        const el = document.getElementById('topbar');
        updateTopbar(el, { auth: { user: null } });
      }
    }
  }
} = {}) {
  await loadFragments(fragments, { cacheBust });

  const topbarEl = document.getElementById('topbar');
  renderTopbar(topbarEl, topbar.state, topbar.handlers);

  initMenuControls();
  highlightActiveMenuItem();
}
