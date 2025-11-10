// /js/topbar.module.js
// ===== Назначение =====
// - Подгружает HTML-фрагменты (меню и др., по желанию).
// - Рендерит топ-бар (без логики "Логин/Выйти": это делает menu-state.js).
// - Управляет меню: open/close, overlay, Escape, popstate, клик по оверлею/ссылкам.
// - Подсвечивает активный пункт меню.
// - Экспортирует initPage(...) для быстрой инициализации на каждой странице.

//// ==================== Утилиты фрагментов ====================

/**
 * Загружает HTML-файл в целевой контейнер.
 * @param {string} url
 * @param {string} targetSelector
 * @param {{cacheBust?: boolean}} opts
 */
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

/**
 * Пакетная загрузка нескольких фрагментов.
 * @param {Array<[string,string]>} jobs [ [url, selector], ... ]
 * @param {{cacheBust?: boolean}} opts
 */
export async function loadFragments(jobs = [], opts = {}) {
  await Promise.all(jobs.map(([url, sel]) => loadFragment(url, sel, opts)));
}

//// ==================== Топ-бар ====================

/**
 * Рендерит топ-бар.
 * ВАЖНО: ссылка авторизации изначально ВСЕГДА "Логин".
 * menu-state.js сам переключит её на "Выйти" и повесит нужные атрибуты.
 * @param {HTMLElement} targetEl
 * @param {{logoHref?:string, logoSrc?:string}} state
 * @param {{onToggleMenu?:Function}} handlers
 */
export function renderTopbar(targetEl, state = {}, handlers = {}) {
  if (!targetEl) return;

  const {
    logoHref = "index.html",
    logoSrc  = "assets/logo400.jpg",
  } = state;

  targetEl.innerHTML = `
    <div class="topbar-inner">
      <button class="menu-toggle"
              aria-controls="sidebar"
              aria-expanded="false"
              aria-label="Открыть меню">☰</button>

      <a class="logo" href="${logoHref}">
        <img src="${logoSrc}" alt="SMART VISION" />
      </a>

      <!-- auth-link изначально «Логин». menu-state.js переключит при наличии сессии -->
      <a id="auth-link" class="login-link" href="login/login.html#login">Логин</a>
    </div>
  `;

  const btn = targetEl.querySelector('.menu-toggle');
  btn?.addEventListener('click', () => {
    if (typeof handlers.onToggleMenu === 'function') handlers.onToggleMenu();
    else openMenu();
  });
}

/**
 * Точечные апдейты топ-бара (логотип/ссылка).
 * НЕ меняем "Логин/Выйти" — за это отвечает menu-state.js.
 * @param {HTMLElement} targetEl
 * @param {{logoHref?:string, logoSrc?:string}} patch
 */
export function updateTopbar(targetEl, patch = {}) {
  if (!targetEl) return;

  if (patch.logoHref) {
    const a = targetEl.querySelector('.logo');
    if (a) a.setAttribute('href', patch.logoHref);
  }
  if (patch.logoSrc) {
    const img = targetEl.querySelector('.logo img');
    if (img) img.setAttribute('src', patch.logoSrc);
  }
}

//// ==================== Меню (open/close, overlay, Escape, popstate) ====================

const BODY_MENU_OPEN_CLASS = 'menu-open';

function qs(sel) { return document.querySelector(sel); }

/** Открыть меню (мобильное) */
export function openMenu() {
  const body = document.body;
  const overlay = qs('#overlay');
  const btn = qs('#topbar .menu-toggle');

  if (!body.classList.contains(BODY_MENU_OPEN_CLASS)) {
    body.classList.add(BODY_MENU_OPEN_CLASS);
    btn?.setAttribute('aria-expanded', 'true');
    if (overlay) overlay.hidden = false;
    // заблокировать скролл body (мягко)
    body.dataset.prevOverflow = body.style.overflow || '';
    body.style.overflow = 'hidden';
  }

  // Сообщим миру (если кому надо)
  window.dispatchEvent(new CustomEvent('sv:menu:open'));
}

/** Закрыть меню */
export function closeMenu() {
  const body = document.body;
  const overlay = qs('#overlay');
  const btn = qs('#topbar .menu-toggle');

  if (body.classList.contains(BODY_MENU_OPEN_CLASS)) {
    body.classList.remove(BODY_MENU_OPEN_CLASS);
    btn?.setAttribute('aria-expanded', 'false');
    if (overlay) overlay.hidden = true;
    // вернуть скролл
    body.style.overflow = body.dataset.prevOverflow || '';
    delete body.dataset.prevOverflow;
  }

  window.dispatchEvent(new CustomEvent('sv:menu:close'));
}

/** Инициализировать управление меню и общие UX-хуки */
export function initMenuControls() {
  const overlay = qs('#overlay');

  // Клик по оверлею закрывает меню
  overlay?.addEventListener('click', () => closeMenu());

  // ESC закрывает меню
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // Навигация назад/вперёд закрывает меню
  window.addEventListener('popstate', () => closeMenu());

  // Клик по ссылке в меню закрывает меню (если это переход)
  const sidebar = qs('#sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('#')) closeMenu();
    });
  }
}

//// ==================== Подсветка активного пункта меню ====================

/**
 * Подсветка активного пункта.
 * 1) Если у ссылок есть data-id: сверяем с именем страницы (about, terms, index...)
 * 2) Иначе — грубая проверка по href (в пределах menu.html).
 */
export function highlightActiveMenuItem() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Текущее имя файла без .html
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const pageId = path.replace(/\.html$/, '') || 'index';

  // Сначала пробуем data-id
  let found = false;
  const links = sidebar.querySelectorAll('a');
  links.forEach((a) => {
    const id = (a.getAttribute('data-id') || '').toLowerCase();
    if (id && id === pageId) {
      a.classList.add('is-active');
      found = true;
    } else {
      a.classList.remove('is-active');
    }
  });

  if (found) return;

  // Фоллбек: по href (если в меню нет data-id)
  links.forEach((a) => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    // простая эвристика: index → index.html, about → about.html, и т.п.
    if (href.endsWith(`${pageId}.html`) || (pageId === 'index' && (href === '' || href.endsWith('index.html')))) {
      a.classList.add('is-active');
    } else {
      a.classList.remove('is-active');
    }
  });
}

//// ==================== Единая инициализация страницы ====================

/**
 * Универсальный запуск страницы.
 * 1) Грузит фрагменты (по умолчанию: ТОЛЬКО меню).
 * 2) Рисует топ-бар.
 * 3) Включает управление меню и подсветку активного пункта.
 *
 * @param {{
 *   fragments?: Array<[string,string]>,
 *   cacheBust?: boolean,
 *   topbar?: {
 *     state?: {logoHref?:string, logoSrc?:string},
 *     handlers?: {onToggleMenu?:Function}
 *   }
 * }} config
 */
export async function initPage({
  fragments = [
    ["menu.html", "#sidebar"], // футер HTML больше не грузим
  ],
  cacheBust = false,
  topbar = {
    state:   { logoHref: "index.html", logoSrc: "assets/logo400.jpg" },
    handlers: {
      onToggleMenu: () => openMenu(),
    }
  }
} = {}) {
  // 1) Подгрузим фрагменты (например, меню)
  if (Array.isArray(fragments) && fragments.length > 0) {
    await loadFragments(fragments, { cacheBust });
  }

  // 2) Рендер топ-бара (без логики логина/логаута)
  const topbarEl = document.getElementById('topbar');
  renderTopbar(topbarEl, topbar.state, topbar.handlers);

  // 3) Управление меню и подсветка
  initMenuControls();
  highlightActiveMenuItem();
}
