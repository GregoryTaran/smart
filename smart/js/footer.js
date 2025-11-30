// ================================================
//  SMART VISION — FOOTER (LocalStorage Edition)
// ================================================

export function renderFooter() {
  const footer = document.getElementById('footer');
  if (!footer) return;

  // Берём данные из localStorage (мгновенно)
  const session = {
    authenticated: localStorage.getItem("sv_authenticated") === "yes",
    user_id: localStorage.getItem("sv_user_id"),
    email: localStorage.getItem("sv_email"),
    name: localStorage.getItem("sv_name"),
    level: localStorage.getItem("sv_level") || 1,
    loading: false
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
//  DEBUG BLOCK
// ------------------------------------------------
function renderDebug(session) {
  return `
    ${row('Authenticated', session.authenticated ? 'yes' : 'no')}
    ${row('User ID', session.user_id || '—')}
    ${row('Email', session.email || '—')}
    ${row('Name', session.name || '—')}
    ${row('Level', session.level)}
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
