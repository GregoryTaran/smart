(async function(){
  try {
    const headContainer = document.getElementById('site-header');
    const footContainer = document.getElementById('site-footer');
    if (headContainer) {
      const r = await fetch('/header.html', {cache:'no-cache'});
      if (r.ok) headContainer.innerHTML = await r.text();
    }
    if (footContainer) {
      const r2 = await fetch('/footer.html', {cache:'no-cache'});
      if (r2.ok) footContainer.innerHTML = await r2.text();
    }
    // highlight active link
    const links = document.querySelectorAll('#site-header a');
    if (links.length) {
      const cur = window.location.pathname.endsWith('/') ? '/index.html' : window.location.pathname;
      links.forEach(a => {
        try {
          if (a.getAttribute('href') === cur) a.classList.add('active');
        } catch(e){}
      });
    }
  } catch(e) {
    console.warn('header/footer load failed', e);
  }
})();
