// /smart/js/topbar.module.js
// Хедер: бургер + логотип + справа "Логин/Выйти" (без верхнего меню).
// Меню рендерится ТОЛЬКО в сайдбаре из menu.html и фильтруется по уровню.

const MENU = [
  { id:'home',  title:'Главная',                 href:'index.html',                       allow:[1,2,3,4,5] },
  { id:'about', title:'О проекте',               href:'about/about.html',                 allow:[1,2,3,4,5] },
  { id:'priv',  title:'Политика конфиденциальности', href:'privacy/privacy.html',       allow:[1,2,3,4,5] },
  { id:'terms', title:'Условия использования',   href:'terms/terms.html',                 allow:[1,2,3,4,5] },

  { id:'login', title:'Вход/регистрация',        href:'login/login.html',                 allow:[1] },

  { id:'ts',    title:'Проверка сервера',        href:'testserver/testserver.html',       allow:[2,3,4,5] },
  { id:'rec',   title:'Диктофон',                href:'voicerecorder/voicerecorder.html', allow:[2,3,4,5] },
  { id:'app',   title:'Мобильное приложение',    href:'app/app.html',                     allow:[1,2,3,4,5] },
  { id:'logout',title:'Выйти',                   href:'#logout', action:'logout',         allow:[2,3,4,5] },

  { id:'admin', title:'Админка',                 href:'admin.html',                       allow:[5] },
];

// ===== Уровень / события SVID =====
const LVL_KEY = 'svid.level';
function level() {
  const v = parseInt(localStorage.getItem(LVL_KEY) || '1', 10);
  return Number.isFinite(v) ? v : 1;
}
function setLevel(n) {
  if (window.SVID?.setLevel) return window.SVID.setLevel(n);
  localStorage.setItem(LVL_KEY, String(n));
  window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: n }}));
}

// ===== ХЕДЕР (без верхнего меню) =====
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

  const btn = topbar.querySelector('.menu-toggle');
  btn?.addEventListener('click', toggleMenu);

  bindAuthLink();
  syncAuthLink(level());
}


// ===== Меню: сайдбар/оверлей =====
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

// ===== Правый “Логин/Выйти” =====
function bindAuthLink() {
  const a = document.getElementById('auth-link');
  if (!a) return;
  a.addEventListener('click', async (e) => {
    if (level() >= 2) {
      e.preventDefault();
      try {
        if (window.SVID?.logout) {
          await window.SVID.logout();    // <<< теперь реальный logout на сервере
        } else {
          // фоллбэк (на всякий)
          localStorage.removeItem('svid.user_id');
          localStorage.removeItem('svid.flags');
          localStorage.removeItem('svid.supabase');
          setLevel(1);
        }
      } finally {
        closeMenu();
      }
    }
  });
}
function syncAuthLink(lvl) {
  const a = document.getElementById('auth-link');
  if (!a) return;
  if (lvl >= 2) {
    a.textContent = 'Выйти';
    a.setAttribute('href', '#logout');
  } else {
    a.textContent = 'Логин';
    a.setAttribute('href', 'login/login.html#login');
  }
}

// ===== Рендер меню ТОЛЬКО в сайдбар (как было) =====
function renderMenu(currentLevel = level()) {
  const host = document.querySelector('[data-svid-menu]');
  if (!host) return;
  const items = MENU.filter(i => i.allow.includes(currentLevel));
  host.innerHTML = `<ul>${
    items.map(i => `<li><a href="${i.href}" data-id="${i.id}" ${i.action ? `data-action="${i.action}"` : ''}>${i.title}</a></li>`).join('')
  }</ul>`;

  // logout по пункту меню
  (host.querySelectorAll?.('[data-action="logout"]') || []).forEach(a => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        if (window.SVID?.logout) {
          await window.SVID.logout();    // <<< реальный logout
        } else {
          localStorage.removeItem('svid.user_id');
          localStorage.removeItem('svid.flags');
          localStorage.removeItem('svid.supabase');
          setLevel(1);
        }
      } finally {
        closeMenu();
      }
    });
  });
}

// ===== Подсветка активного =====
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

// ===== Загрузка фрагмента сайдбара (если используешь menu.html) =====
async function loadFragment(url, sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  const html = await (await fetch(url, { cache: 'no-cache' })).text();
  el.innerHTML = html;
}

// ===== Точка входа =====
export async function initPage({
  fragments = [['menu.html', '#sidebar']],   // menu.html: <nav class="menu" data-svid-menu></nav>
  cacheBust = false,
  topbar = { state: { logoHref: 'index.html', logoSrc: 'assets/logo400.jpg' } }
} = {}) {
  // 1) хедер
  renderTopbar(topbar.state);

  // 2) фрагмент меню (сайдбар)
  for (const [url, sel] of fragments) {
    await loadFragment(cacheBust ? `${url}?_=${Date.now()}` : url, sel);
  }

  // 3) UX
  initMenuControls();

  // 4) первый проход
  const ready = window.SVID?.ready || Promise.resolve({ level: level() });
  await ready.then(({ level }) => {
    syncAuthLink(level);
    renderMenu(level);
    highlightActive();
  });

  // 5) реакции
  window.addEventListener('svid:level', e => {
    const lvl = e.detail.level;
    syncAuthLink(lvl);
    renderMenu(lvl);
    highlightActive();
  });
  window.addEventListener('storage', e => {
    if (e.key === LVL_KEY) {
      const lvl = parseInt(e.newValue || '1',10);
      syncAuthLink(lvl);
      renderMenu(lvl);
      highlightActive();
    }
  });
}
