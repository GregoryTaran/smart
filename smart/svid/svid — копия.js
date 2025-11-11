// SMART/js/svid.js
(async function() {
  const API = '/identity/svid/init';
  const LS_ID = 'svid.visitor_id';
  const LS_LEVEL = 'svid.level';

  function getDeviceInfo() {
    const ua = navigator.userAgent;
    return {
      device_type: /Mobile/i.test(ua) ? 'mobile' : 'desktop',
      device_class: /Tablet/i.test(ua) ? 'tablet' : (/Mobile/i.test(ua) ? 'phone' : 'desktop'),
      os_name: navigator.platform,
      browser_name: navigator.userAgent,
      screen_width: screen.width,
      screen_height: screen.height,
      touch_support: 'ontouchstart' in window,
      app_platform: 'browser',
      timezone_guess: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  function getUTM() {
    const p = new URLSearchParams(location.search);
    const f = (k) => p.get(k) || null;
    return {
      utm_source: f('utm_source'),
      utm_medium: f('utm_medium'),
      utm_campaign: f('utm_campaign'),
      utm_term: f('utm_term'),
      utm_content: f('utm_content'),
    };
  }

  async function initVisitor() {
    const existing = localStorage.getItem(LS_ID);
    if (existing) {
      showInfo(existing, localStorage.getItem(LS_LEVEL) || 1);
      return;
    }

    const payload = {
      landing_url: location.href,
      referrer_host: document.referrer ? new URL(document.referrer).host : '',
      ...getDeviceInfo(),
      ...getUTM(),
    };

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      localStorage.setItem(LS_ID, data.visitor_id);
      localStorage.setItem(LS_LEVEL, data.level);
      showInfo(data.visitor_id, data.level);
    } catch (err) {
      console.error('[SVID] init error', err);
      showInfo('error', 'n/a');
    }
  }

  function showInfo(id, level) {
    let box = document.getElementById('svid-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'svid-box';
      box.style.cssText = `
        position:fixed;bottom:10px;right:10px;
        background:#111;color:#fff;padding:10px 14px;
        border-radius:8px;font:14px/1.4 system-ui;
        z-index:9999;opacity:.9;`;
      document.body.appendChild(box);
    }
    box.innerHTML = `Visitor: <b>${id}</b><br>Level: <b>${level}</b>`;
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initVisitor);
  else
    initVisitor();
})();
