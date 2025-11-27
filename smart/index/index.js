// index/index.js — simple placeholder card on index
(function () {
  function mountCard() {
    var card = document.createElement('div');
    card.className = 'card';
    card.style.margin = '16px auto';
    card.style.maxWidth = '720px';
    card.style.padding = '16px 18px';
    card.innerHTML = '<h2 style="margin:0 0 8px">SMART VISION от Index.js</h2><p>2025@</p>';
    var host = document.querySelector('main') || document.getElementById('content') || document.body;
    host.appendChild(card);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountCard, { once: true });
  } else {
    mountCard();
  }
})(); 
