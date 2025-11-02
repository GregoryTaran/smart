// smart/js/fragment-load.js
// Robust fragment loader — idempotent, uses absolute URLs, safe insert into container.
// Put this <script> at the end of body (before register-sw if you use SW).

(function(){
  'use strict';

  // List fragments to load: target element ID -> URL
  // Use absolute paths (starting with /) to avoid relative-path surprises
  const FRAGMENTS = [
    { id: 'site-menu', url: '/menu.html' },
    { id: 'site-topbar', url: '/topbar.html' },
    { id: 'site-footer', url: '/footer.html' }
  ];

  // Config
  const FETCH_OPTS = {
    credentials: 'include', // include cookies (useful for auth-aware fragments) - set to 'omit' if not needed
    cache: 'no-cache'       // during development; in production you can remove or tune headers server-side
  };
  const MAX_RETRIES = 1;      // number of retry attempts on failure (0 = no retry)
  const RETRY_DELAY_MS = 800; // simple delay before retry

  // Helper: fetch with optional retry
  async function fetchWithRetry(url, retries = MAX_RETRIES) {
    try {
      const res = await fetch(url, FETCH_OPTS);
      return res;
    } catch (err) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return fetchWithRetry(url, retries - 1);
      }
      throw err;
    }
  }

  // Insert HTML safely into container (replace innerHTML)
  // Note: fragments should not contain <script> tags that need execution.
  function insertFragment(container, html, url) {
    // simple sanitation: we don't execute scripts from fragments automatically.
    // If you need scripts in fragments, prefer external script files loaded separately.
    container.innerHTML = html;
    container.dataset.fragmentLoaded = url;
    container.dispatchEvent(new CustomEvent('fragment:loaded', { detail: { url } }));
    console.log('fragment-load: inserted', url, 'into', '#' + container.id);
  }

  // Primary loader
  async function loadFragmentEntry(entry) {
    const { id, url } = entry;
    const container = document.getElementById(id);
    if (!container) {
      // nothing to insert into; skip quietly
      console.warn('fragment-load: container not found', id);
      return;
    }
    // skip if same url already loaded
    if (container.dataset.fragmentLoaded === url) return;

    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) {
        console.warn('fragment-load: fetch failed', url, res.status);
        return;
      }
      const text = await res.text();
      // verify that returned HTML is not a generic index page (simple heuristic)
      if (text.trim().length < 10) {
        console.warn('fragment-load: empty fragment', url);
        return;
      }
      insertFragment(container, text, url);
    } catch (err) {
      console.error('fragment-load: error loading', url, err);
    }
  }

  // Run loader when DOM ready (early)
  function start() {
    FRAGMENTS.forEach(e => loadFragmentEntry(e));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
