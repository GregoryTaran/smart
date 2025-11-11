/* topbar.module.js
   Проект: SMART VISION
   Философия: топбар и сайдбар-меню реагируют на уровень SVID (гость=1, пользователь=2)
   Интеграция: фронт слушает кастомные события от SVID (window "svid:level") и читает localStorage('svid.level').

   БЭКЕНД: модуль svid на сервере, роуты под /api/svid/*
   (например POST /api/svid/login, POST /api/svid/logout и т.д.)
*/

const MENU = [
  { id:'home',  title:'Главная',                 href:'index.html',                       allow:[1,2] },
  { id:'about', title:'О проекте',               href:'about/about.html',                 allow:[1,2] },
  { id:'priv',  title:'Политика конфиденциальности', href:'privacy/privacy.html',       allow:[1,2] },
  { id:'terms', title:'Условия использования',   href:'terms/terms.html',                 allow:[1,2] },

  { id:'login', title:'Вход/регистрация',        href:'login/login.html',                 allow:[1] },

  { id:'ts',    title:'Проверка сервера',        href:'testserver/testserver.html',       allow:[2] },
  { id:'rec',   title:'Диктофон',                href:'voicerecorder/voicerecorder.html', allow:[2] },
  { id:'app',   title:'Мобильное приложение',    href:'app/app.html',                     allow:[1,2] },
  { id:'logout',title:'Выйти',                   href:'#logout', action:'logout',         allow:[2] },
];

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

// Правый “Логин/Выйти”
function bindAuthLink() {
  const a = document.getElementById('auth-link');
  if (!a) return;
  a.addEventListener('click', async (e) => {
    if (level() >= 2) {
      e.preventDefault();
      try {
        if (window.SVID?.logout) {
          await window.SVID.logout(); // серверный /api/svid/logout
        } else {
          // фоллбэк
          localStorage.removeItem('svid.user_id');
          localStorage.removeItem('svid.user_level');
          localStorage.removeItem('svid.jwt');
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

function renderMenu(currentLevel = level()) {
  const host = document.querySelector('[data-svid-menu]');
  if (!host) return;
  const items = MENU.filter(i => i.allow.includes(currentLevel));
  host.innerHTML = `<ul>${
    items.map(i => `<li><a href="${i.href}" data-id="${i.id}" ${i.action ? `data-action="${i.action}"` : ''}>${i.title}</a></li>`).join('')
  }</ul>`;

  (host.querySelectorAll?.('[data-action="logout"]') || []).forEach(a => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        if (window.SVID?.logout) {
          await window.SVID.logout();
        } else {
          localStorage.removeItem('svid.user_id');
          localStorage.removeItem('svid.user_level');
          localStorage.removeItem('svid.jwt');
          setLevel(1);
        }
      } finally {
        closeMenu();
      }
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
  syncAuthLink(level());
}

export async function initPage({
  fragments = [['menu.html', '#sidebar']],
  cacheBust = false,
  topbar = { state: { logoHref: 'index.html', logoSrc: 'assets/logo400.jpg' } }
} = {}) {
  renderTopbar(topbar.state);

  // --- NEW: если уровень ещё не установлен, попробуем бустануть его из SVID.getState()
  if (!localStorage.getItem(LVL_KEY) && window.SVID?.getState) {
    const st = window.SVID.getState();
    const lvl = Number(st.user_level) || Number(st.visitor_level) || 1;
    localStorage.setItem(LVL_KEY, String(lvl));
    window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: lvl } }));
    console.log('[TOPBAR] bootstrap UI level ->', lvl);
  }

  for (const [url, sel] of fragments) {
    await loadFragment(cacheBust ? `${url}?_=${Date.now()}` : url, sel);
  }
  initMenuControls();

  const ready = window.SVID?.ready || Promise.resolve({ level: level() });
  await ready.then(({ level }) => {
    syncAuthLink(level);
    renderMenu(level);
    highlightActive();
  });

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

  // --- NEW: при возврате страницы из истории (bfcache) переинициализируем меню
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      const cur = Number(localStorage.getItem(LVL_KEY)) || 1;
      // если почему-то ключа нет — спросим у SVID
      if (!localStorage.getItem(LVL_KEY) && window.SVID?.getState) {
        const st = window.SVID.getState();
        const lvl = Number(st.user_level) || Number(st.visitor_level) || 1;
        localStorage.setItem(LVL_KEY, String(lvl));
        window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: lvl } }));
        console.log('[TOPBAR] pageshow: restored UI level ->', lvl);
        return;
      }
      window.dispatchEvent(new CustomEvent('svid:level', { detail: { level: cur } }));
      console.log('[TOPBAR] pageshow: re-render with level ->', cur);
    }
  });
}
