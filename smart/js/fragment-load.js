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

  await Promise.all([
    loadInto('/menu.html','site-menu'),
    loadInto('/topbar.html','site-topbar'),
    loadInto('/footer.html','site-footer')
  ]);

  // highlight active link
  try {
    const cur = window.location.pathname.endsWith('/') ? '/index.html' : window.location.pathname;
    document.querySelectorAll('#site-menu a').forEach(a => {
      if (a.getAttribute('href') === cur) a.classList.add('active');
    });
  } catch(e){}

  // menu toggle (delegated after topbar insertion)
  function getMenuToggle(){
    return document.getElementById('menu-toggle');
  }
  function closeMenu(){
    document.body.classList.remove('menu-open');
  }
  function openMenu(){
    document.body.classList.add('menu-open');
  }

  // attach toggle (if exists)
  const toggle = getMenuToggle();
  if (toggle){
    toggle.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      if (document.body.classList.contains('menu-open')) closeMenu(); else openMenu();
    });
  }

  // click on backdrop closes menu
  document.addEventListener('click', (e)=>{
    if (!document.body.classList.contains('menu-open')) return;
    // if click inside menu, do nothing
    const menu = document.getElementById('site-menu');
    if (menu && menu.contains(e.target)) return;
    // otherwise close
    closeMenu();
  });

  // close on ESC
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') closeMenu();
  });

})();
