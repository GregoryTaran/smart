/* js/footer.js — футер + Informer (новая версия под SV_AUTH)
   - Всегда создаёт #footer на странице, если его нет
   - Внутри #footer создаёт .footer-inner и карточку .card#svFooterInfo
   - Предоставляет API: window.SV.footer.setInfo(html)
   - Информер читает window.SV_AUTH и обновляется по событию 'sv:auth-ready'
*/

(function () {
  // ==== РЕНДЕР ФУТЕРА =======================================================
  function ensureFooter() {
    var root = document.getElementById('footer');
    if (!root) {
      root = document.createElement('footer');
      root.id = 'footer';
      document.body.appendChild(root);
    }

    // Внутренний контейнер
    var inner = root.querySelector('.footer-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'footer-inner';
      root.appendChild(inner);
    }

    // Карточка информера
    var card = document.getElementById('svFooterInfo');
    if (!card) {
      card = document.createElement('div');
      card.id = 'svFooterInfo';
      card.className = 'card'; // стили берём из main.css
      inner.appendChild(card);
    }

    // Глобальный API футера
    window.SV = window.SV || {};
    window.SV.footer = window.SV.footer || {};
    window.SV.footer.setInfo = function setInfo(html) {
      card.innerHTML = html || '';
    };
  }

  // ==== УТИЛИТЫ =============================================================
  function row(label, value) {
    var v = value == null || value === '' ? '—' : String(value);
    return (
      '<div class="sv-row"><strong>' +
      esc(label) +
      ':</strong> <code>' +
      esc(v) +
      '</code></div>'
    );
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ==== СНИМОК ИЗ window.SV_AUTH ============================================
  function snapshot() {
    var auth = (window.SV_AUTH && typeof window.SV_AUTH === 'object')
      ? window.SV_AUTH
      : {};

    var lvl = Number(auth.level || 1) || 1;
    var levelCode =
      auth.levelCode || (lvl === 1 ? 'guest' : 'user');

    return {
      loaded: !!auth.loaded,
      isAuthenticated: !!auth.isAuthenticated,
      userId: auth.userId || '—',
      level: lvl,
      levelCode: levelCode,
      email: auth.email || '—',
      displayName: auth.displayName || '—'
    };
  }

  // ==== РЕНДЕР ИНФОРМЕРА ====================================================
  function renderInformer() {
    ensureFooter();
    var s = snapshot();
    var html = [
      row('Auth loaded', s.loaded ? 'yes' : 'no'),
      row('Authenticated', s.isAuthenticated ? 'yes' : 'no'),
      row('User ID', s.userId),
      row('Level', s.level),
      row('Level code', s.levelCode),
      row('Email', s.email),
      row('Name', s.displayName)
    ].join('');
    window.SV.footer.setInfo(html);
  }

  // ==== ПОДПИСКИ НА СОБЫТИЯ =================================================
  function subscribe() {
    // Когда скрипт в <head> получил /api/auth/session и кинул 'sv:auth-ready'
    document.addEventListener('sv:auth-ready', function () {
      renderInformer();
    });

    // На всякий случай при возврате из bfcache
    window.addEventListener('pageshow', function () {
      renderInformer();
    });

    // Если где-то в коде ты будешь кидать своё событие логаута
    window.addEventListener('sv:logout', function () {
      renderInformer();
    });
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
