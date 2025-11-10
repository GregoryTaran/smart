// smart/svid/visitor.js
(function () {
  const LS_ID = 'sv_vid';
  const LS_LEVEL = 'sv_level';
  const ENDPOINT = '/identity/visitor';

  function parseUTM() {
    const params = new URLSearchParams(window.location.search);
    const get = (k) => params.get(k) || null;
    return {
      source: get('utm_source'),
      medium: get('utm_medium'),
      campaign: get('utm_campaign'),
      term: get('utm_term'),
      content: get('utm_content'),
    };
  }

  function detectDeviceType() {
    const ua = navigator.userAgent || '';
    const isTablet = /iPad|Tablet/i.test(ua);
    const isMobile = /Android|iPhone|Mobile/i.test(ua);
    if (isTablet) return 'tablet';
    if (isMobile) return 'mobile';
    return 'desktop';
  }

  async function createVisitor() {
    const body = {
      sv_vid: null,
      landing_url: window.location.href,
      referrer_host: (document.referrer ? new URL(document.referrer).host : ''),
      utm: parseUTM(),
      device_type: detectDeviceType(),
      app_platform: 'browser'
    };

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });

    if (!res.ok) throw new Error('Visitor create failed: ' + res.status);
    return res.json();
  }

  function renderInfo(id, level) {
    let container = document.getElementById('visitor-id');
    if (!container) {
      container = document.createElement('div');
      container.id = 'visitor-id';
      container.style.cssText = 'position:fixed;top:8px;left:8px;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:14px/1.4 system-ui, -apple-system, Segoe UI, Roboto;z-index:9999';
      document.body.appendChild(container);
    }
    container.innerHTML = `Visitor ID: <b>${id}</b><br/>Level: <b>${level}</b>`;
  }

  async function init() {
    try {
      const existingId = localStorage.getItem(LS_ID);
      const existingLevel = localStorage.getItem(LS_LEVEL);

      if (existingId) {
        renderInfo(existingId, existingLevel || 1);
        return;
      }

      const data = await createVisitor(); // { visitor_id, level, created }
      if (data && data.visitor_id) {
        localStorage.setItem(LS_ID, data.visitor_id);
        localStorage.setItem(LS_LEVEL, (data.level ?? 1));
        renderInfo(data.visitor_id, data.level ?? 1);
      } else {
        throw new Error('Bad response payload');
      }
    } catch (e) {
      console.warn('[SVID] Visitor init error:', e);
      renderInfo('error', 'n/a');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();