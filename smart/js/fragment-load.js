// smart/js/fragment-load.js
// Загрузка фрагментов (menu/topbar/footer) и мобильная логика меню.
// Относительные пути используются намеренно (menu.html, topbar.html, footer.html)
// чтобы Live Server работал корректно, когда корнем сервера является папка `smart/`.

(async function () {
  'use strict';

  async function loadInto(url, id) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Fetch failed ' + res.status + ' ' + url);
      const txt = await res.text();
      const el = document.getElementById(id);
      if (el) el.innerHTML = txt;
      return true;
    } catch (err) {
      console.warn('[fragment-load] failed to load', url, err);
      return false;
    }
  }

  // Load fragments in parallel
  await Promise.all([
    loadInto('menu.html', 'site-menu'),
    loadInto('topbar.html', 'site-topbar'),
    loadInto('footer.html', 'site-footer')
  ]);

  // ======= Helpers =======
  const body = document.body;

  function openMenu() { body.classList.add('menu-open'); }
  function closeMenu() { body.classList.remove('menu-open'); }

  // Normalize current path for comparison (leading slash)
  function currentPath() {
    let p = window.location.pathname;
    if (!p || p === '') p = '/index.html';
    return p;
  }

  // Find and mark active menu link(s)
  try {
    const cur = currentPath();
    const links = document.querySelectorAll('#site-menu a');
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      // Compare absolute and trimmed forms
      const normalizedHref = href.startsWith('/') ? href : ('/' + href.replace(/^\.\//, ''));
      if (normalizedHref === cur) {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    });
  } catch (e) {
    // silent
  }

  // ======= Attach UI behavior =======
  // Menu toggle (burger) in topbar
  const toggle = document.getElementById('menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (body.classList.contains('menu-open')) closeMenu(); else openMenu();
    });
  }

  // Close button (✕) inside menu (mobile)
  const closeBtn = document.getElementById('menu-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeMenu();
    });
  }

  // When clicking outside the menu while it's open -> close
  document.addEventListener('click', function (e) {
    if (!body.classList.contains('menu-open')) return;
    const menu = document.getElementById('site-menu');
    if (menu && menu.contains(e.target)) return; // click inside menu -> keep open
    closeMenu();
  });

  // Close on ESC
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') closeMenu();
  });

  // Close menu when clicking a link (mobile UX)
  try {
    document.querySelectorAll('#site-menu a').forEach(a => {
      a.addEventListener('click', function (ev) {
        // If the menu is open (mobile), close it. Wait a tick so navigation can start cleanly.
        if (body.classList.contains('menu-open')) {
          // For same-page anchors we still want to close without delay problems.
          setTimeout(() => closeMenu(), 60);
        }
      });
    });
  } catch (e) {
    // ignore
  }

  // Accessibility: focus trap is out of scope, but ensure menu toggle is focusable
  // and aria-expanded could be wired if needed later.

  // Debug/info
  // console.log('[fragment-load] fragments loaded, menu controls attached');
})();
