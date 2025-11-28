/* js/footer.js — чистая версия под AUTH v3 */

(function () {

  // ==== РЕНДЕР ФУТЕРА =======================================================
  function ensureFooter() {
    let root = document.getElementById('footer');
    if (!root) {
      root = document.createElement('footer');
      root.id = 'footer';
      document.body.appendChild(root);
    }

    let inner = root.querySelector('.footer-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'footer-inner';
      root.appendChild(inner);
    }

    let card = document.getElementById('svFooterInfo');
    if (!card) {
      card = document.createElement('div');
      card.id = 'svFooterInfo';
      card.className = 'card';
      inner.appendChild(card);
    }

    window.SV = window.SV || {};
    window.SV.footer = window.SV.footer || {};
    window.SV.footer.setInfo = html => {
      card.innerHTML = html || '';
    };
  }

  // ==== HELPERS =============================================================
  const esc = s =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const row = (label, value) =>
    `<div class="sv-row"><strong>${esc(label)}:</strong> <code>${esc(value || '—')}</code></div>`;

  // ==== SNAPSHOT ============================================================
  function snapshot() {
    const auth = window.SV_AUTH || {};
    const lvl = Number(auth.level || 1);
    return {
      loaded: !!auth.loaded,
      isAuthenticated: !!auth.isAuthenticated,
      userId: auth.userId || '—',
      email: auth.email || '—',
      displayName: auth.displayName || '—',
      level: lvl,
      levelCode: auth.levelCode || (lvl === 1 ? 'guest' : 'user')
    };
  }

  // ==== РЕНДЕР ==============================================================
  function renderInformer() {
    ensureFooter();
    const s = snapshot();
    window.SV.footer.setInfo(
      row('Auth loaded', s.loaded ? 'yes' : 'no') +
      row('Authenticated', s.isAuthenticated ? 'yes' : 'no') +
      row('User ID', s.userId) +
      row('Level', s.level) +
      row('Level code', s.levelCode) +
      row('Email', s.email) +
      row('Name', s.displayName)
    );
  }

  // ==== СЛУШАЕМ SV_AUTH.ready ===============================================
  function subscribe() {
    // Когда AUTH загрузился
    if (window.SV_AUTH?.ready) {
      window.SV_AUTH.ready.then(() => renderInformer());
    }

    // На всякий случай при возврате из bfcache
    window.addEventListener('pageshow', () => renderInformer());

    // Если где-то вручную вызовут
    window.addEventListener('sv:auth-changed', () => renderInformer());
  }

  function start() {
    ensureFooter();
    renderInformer();
    subscribe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

})();
