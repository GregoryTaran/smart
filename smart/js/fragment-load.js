(async function(){
  async function loadInto(url, id){
    try {
      const res = await fetch(url, {cache:'no-cache'});
      if (!res.ok) throw new Error('Fetch failed '+res.status);
      const txt = await res.text();
      const el = document.getElementById(id);
      if (el) el.innerHTML = txt;
      return true;
    } catch(e){
      console.warn('Failed to load', url, e);
      return false;
    }
  }

  // relative paths so running Live Server with smart/ as root works
  await Promise.all([
    loadInto('menu.html','site-menu'),
    loadInto('topbar.html','site-topbar'),
    loadInto('footer.html','site-footer')
  ]);

  // highlight active link (adds 'active' class)
  try {
    const cur = window.location.pathname.endsWith('/') ? '/index.html' : window.location.pathname;
    document.querySelectorAll('#site-menu a').forEach(a => {
      const href = a.getAttribute('href');
      // handle absolute and relative hrefs
      if (href === cur || href === cur.replace(/^\/+/,'')) a.classList.add('active');
    });
  } catch(e){}

  // menu toggle behavior
  function openMenu(){ document.body.classList.add('menu-open'); }
  function closeMenu(){ document.body.classList.remove('menu-open'); }

  const toggle = document.getElementById('menu-toggle');
  if (toggle){
    toggle.addEventListener('click', function(ev){
      ev.stopPropagation();
      if (document.body.classList.contains('menu-open')) closeMenu(); else openMenu();
    });
  }

  // close when clicking outside menu
  document.addEventListener('click', function(e){
    if (!document.body.classList.contains('menu-open')) return;
    const menu = document.getElementById('site-menu');
    if (menu && menu.contains(e.target)) return;
    closeMenu();
  });

  // close on Escape
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closeMenu();
  });
})();