// ======================================================================
// FOOTER DEBUG PANEL (SmartID Edition)
// Совместим с новой архитектурой, полностью чистый
// ======================================================================

export function renderFooter(session) {
  const footer = document.getElementById('footer');
  if (!footer) return;

  const year = new Date().getFullYear();

  // ----- Создаём базовую структуру -----
  footer.innerHTML = `
    <div class="footer-inner">

      <div class="footer-left">
        <strong>SMART VISION</strong> © ${year}
      </div>

      <div class="footer-right">
        <div id="svFooterInfo" class="card" style="padding: 12px; font-size: 0.85rem;">
          ${renderDebug(session)}
        </div>
      </div>

    </div>
  `;
}

// ======================================================================
// РЕНДЕР DEBUG-ИНФОРМАЦИИ
// ======================================================================
function renderDebug(session) {
  return `
    ${row('Authenticated', session.authenticated ? 'yes' : 'no')}
    ${row('User ID', session.user_id || '—')}
    ${row('Email', session.email || '—')}
    ${row('Level', session.level || 1)}
  `;
}

// ======================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ======================================================================
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value) {
  return `
    <div class="sv-row">
      <strong>${esc(label)}:</strong> <code>${esc(value)}</code>
    </div>
  `;
}
