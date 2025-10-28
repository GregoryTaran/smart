(async function(){
  async function loadInto(url, containerId) {
    try {
      const res = await fetch(url, {cache: 'no-cache'});
      if (!res.ok) throw new Error('not ok '+res.status);
      const txt = await res.text();
      const el = document.getElementById(containerId);
      if(el) el.innerHTML = txt;
    } catch(err) {
      console.warn('Failed to load', url, err);
    }
  }

  await Promise.all([
    loadInto('/menu.html','site-menu'),
    loadInto('/topbar.html','site-topbar'),
    loadInto('/footer.html','site-footer')
  ]);

  try {
    const links = document.querySelectorAll('#site-menu a');
    const cur = window.location.pathname.endsWith('/') ? '/index.html' : window.location.pathname;
    links.forEach(a => { if (a.getAttribute('href') === cur) a.classList.add('active'); });
  } catch(e){}
})();