// ================================================
//  SMART VISION — FOOTER (работает напрямую с SMART_SESSION)
// ================================================

export function renderFooter() {
  const footer = document.getElementById('footer');
  if (!footer) return;

  const session = window.SMART_SESSION || {
    authenticated: false,
    level: 1,
    user_id: null,
    email: null,
    name: null,
    loading: true
  };

  const year = new Date().getFullYear();

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

// ------------------------------------------------
//  DEBUG BLOCK (системное состояние)
// ------------------------------------------------
function renderDebug(session) {
  return `
    ${row('Loading', session.loading ? 'yes' : 'no')}
    ${row('Authenticated', session.authenticated ? 'yes' : 'no')}
    ${row('User ID', session.user_id || '—')}
    ${row('Email', session.email || '—')}
    ${row('Name', session.name || '—')}
    ${row('Level', session.level || 1)}
  `;
}

// ------------------------------------------------
//  ESCAPE HELPERS
// ------------------------------------------------
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
