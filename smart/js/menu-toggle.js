// smart/js/menu-toggle.js
(function(){
  'use strict';

  // INIT function (safe to call multiple times)
  function initMenu() {
    const siteMenu = document.getElementById('site-menu');
    const topbar = document.getElementById('site-topbar');
    const toggle = document.querySelector('.menu-toggle');
    if (!siteMenu || !topbar || !toggle) return;

    // Ensure backdrop exists
    let backdrop = document.querySelector('.mobile-menu-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'mobile-menu-backdrop';
      document.body.appendChild(backdrop);
    }

    // Add close button into menu if not present (mobile overlay)
    let closeBtn = siteMenu.querySelector('.menu-close');
    if (!closeBtn) {
      closeBtn = document.createElement('button');
      closeBtn.className = 'menu-close';
      closeBtn.type = 'button';
      closeBtn.innerHTML = '✕';
      // position absolute works because menu has padding
      siteMenu.insertBefore(closeBtn, siteMenu.firstChild);
    }

    function openMenu() {
      document.body.classList.add('menu-open');
      // lock scroll on body (optional)
      document.body.style.overflow = 'hidden';
      // focus first link
      const firstLink = siteMenu.querySelector('a');
      if (firstLink) firstLink.focus();
    }
    function closeMenu() {
      document.body.classList.remove('menu-open');
      document.body.style.overflow = ''; // restore
      toggle.focus();
    }
    // toggle button
    toggle.addEventListener('click', function(e){
      e.preventDefault();
      if (document.body.classList.contains('menu-open')) closeMenu();
      else openMenu();
    });
    // close btn
    closeBtn.addEventListener('click', function(e){
      e.preventDefault();
      closeMenu();
    });
    // backdrop click closes
    backdrop.addEventListener('click', function(){ closeMenu(); });

    // clicking a menu link closes overlay (mobile)
    siteMenu.addEventListener('click', function(e){
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      // allow links that are hash anchors etc.
      closeMenu();
      // let default link behavior continue (navigation)
    });

    // mark active menu item by comparing path
    (function markActive() {
      try {
        const path = location.pathname.replace(/\/+$/, '') || '/';
        const links = siteMenu.querySelectorAll('a');
        links.forEach(a=>{
          // normalize href path
          const href = a.getAttribute('href') || '';
          // ignore external links
          if (/^(http|\/\/)/.test(href)) return;
          const url = new URL(href, location.origin);
          const p = url.pathname.replace(/\/+$/, '') || '/';
          if (p === path) a.classList.add('active');
          else a.classList.remove('active');
        });
      } catch(e) {}
    })();

    // Accessibility: close menu on Escape
    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape' && document.body.classList.contains('menu-open')) {
        closeMenu();
      }
    });
  } // initMenu

  // If fragments are inserted and dispatch 'fragment:loaded' (our fragment-load does that),
  // init after that. Also run on DOMContentLoaded for static inline header.
  function tryInit() {
    initMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

  // Also listen to fragment inserted events (fragment-load dispatches 'fragment:loaded')
  document.addEventListener('fragment:loaded', function(e){
    // small delay if needed
    setTimeout(initMenu, 10);
  });

})();
