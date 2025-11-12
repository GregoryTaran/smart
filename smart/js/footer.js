/* js/footer.js — футер + встроенный Informer (карточка)
   - Всегда создаёт #footer на странице, если его нет
   - Внутри #footer создаёт .footer-inner и карточку .card#svFooterInfo
   - Предоставляет API: window.SV.footer.setInfo(html)
   - Информер читает ключи SVID из localStorage и обновляется по событиям
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

  // ==== ИНФОРМЕР ============================================================
  // Рендер одной строки
  function row(label, value) {
    var v = (value == null || value === "") ? "—" : String(value);
    return '<div class="sv-row"><strong>' + esc(label) + ':</strong> <code>' + esc(v) + '</code></div>';
  }
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}

  // Снимок SVID из localStorage
  function snapshot() {
    var ls = window.localStorage;
    var user_id     = safeGet(ls, 'svid.user_id');
    var visitor_id  = safeGet(ls, 'svid.visitor_id'); // если появится
    var user_level  = safeGet(ls, 'svid.user_level');
    var level       = safeGet(ls, 'svid.level');
    var jwt         = safeGet(ls, 'svid.jwt');
    var lvl = Number(level || user_level || 1) || 1;
    var jwtShort = jwt ? (String(jwt).slice(0, 12) + '…') : '—';
    return {
      userId: user_id || '—',
      visitorId: visitor_id || '—',
      level: lvl,
      jwtShort: jwtShort
    };
  }

  function safeGet(ls, key){ try{ return ls.getItem(key); } catch(e){ return null; } }

  function renderInformer() {
    ensureFooter();
    var s = snapshot();
    var html = [
      row('User ID',    s.userId),
      row('Visitor ID', s.visitorId),
      row('Level',      s.level),
      row('JWT',        s.jwtShort)
    ].join('');
    window.SV.footer.setInfo(html);
  }

  function subscribe() {
    window.addEventListener('svid:user', renderInformer);
    window.addEventListener('svid:logout', renderInformer);
    window.addEventListener('storage', function(e){ if (e && e.key && e.key.indexOf('svid.') === 0) renderInformer(); });
    window.addEventListener('pageshow', function(e){ if (e && e.persisted) renderInformer(); });
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
