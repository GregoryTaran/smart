// js/zaprosrazreshenijbrauzera.js
// Единый модуль запросов разрешений: mic / cam / notifications / geolocation

(() => {
  const $ = (s) => document.querySelector(s);

  let statusEl = null;
  function setStatusEl(el) { statusEl = el; }
  function _status(msg) {
    if (!statusEl) return;
    statusEl.textContent = String(msg);
  }

  // --- helpers ---
  async function queryPerm(name) {
    // Permissions API не везде поддерживает 'camera'/'microphone'/'geolocation'
    if (!('permissions' in navigator)) return 'unknown';
    try {
      const res = await navigator.permissions.query({ name });
      return res.state; // 'granted' | 'denied' | 'prompt'
    } catch {
      return 'unknown';
    }
  }
  function stopTracks(stream) {
    try { stream?.getTracks?.().forEach(t => t.stop()); } catch {}
  }
  function insecureContext() {
    // Гео/уведомления требуют HTTPS (кроме localhost)
    const isLocalhost = /^(localhost|127\.0\.0\.1)/.test(location.hostname);
    return location.protocol !== 'https:' && !isLocalhost;
  }

  // --- MIC ---
  async function ensureMic() {
    _status('mic: requesting…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopTracks(stream);
      const p = await queryPerm('microphone');
      _status(`mic: granted (${p})`);
    } catch (e) {
      _status(`mic: error → ${e?.name || e}`);
    }
  }

  // --- CAMERA ---
  async function ensureCam() {
    _status('camera: requesting…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stopTracks(stream);
      const p = await queryPerm('camera');
      _status(`camera: granted (${p})`);
    } catch (e) {
      _status(`camera: error → ${e?.name || e}`);
    }
  }

  // --- NOTIFICATIONS ---
  async function ensureNotifications() {
    if (!('Notification' in window)) {
      _status('notifications: not supported');
      return;
    }
    if (insecureContext()) {
      _status('notifications: need HTTPS (or localhost)');
      return;
    }
    _status('notifications: requesting…');
    try {
      const res = await Notification.requestPermission();
      _status(`notifications: ${res}`);
    } catch (e) {
      _status(`notifications: error → ${e?.message || e}`);
    }
  }

  // --- GEOLOCATION ---
  async function ensureGeo() {
    if (!('geolocation' in navigator)) {
      _status('geo: not supported');
      return;
    }
    if (insecureContext()) {
      _status('geo: need HTTPS (or localhost)');
      return;
    }
    _status('geo: requesting…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        _status(`geo: ok lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} acc≈${Math.round(accuracy)}m`);
      },
      (err) => {
        _status(`geo: error → ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // --- initial snapshot of permissions/status ---
  async function initialStatus() {
    const mic = await queryPerm('microphone');
    const cam = await queryPerm('camera');
    const noti = ('Notification' in window) ? Notification.permission : 'unsupported';
    const geo = ('geolocation' in navigator) ? (insecureContext() ? 'need-https' : 'unknown') : 'unsupported';

    _status([
      'status:',
      `mic=${mic}`,
      `cam=${cam}`,
      `notifications=${noti}`,
      `geo=${geo}`
    ].join('\n'));
  }

  // --- wiring ---
  function wire() {
    const el = $('#permStatus');
    const btnMic  = $('#btnMic');
    const btnCam  = $('#btnCam');
    const btnNoti = $('#btnNoti');
    const btnGeo  = $('#btnGeo');

    if (!el) return; // блок не размещён — тихо выходим
    setStatusEl(el);

    btnMic?.addEventListener('click', ensureMic, { passive: true });
    btnCam?.addEventListener('click', ensureCam, { passive: true });
    btnNoti?.addEventListener('click', ensureNotifications, { passive: true });
    btnGeo?.addEventListener('click', ensureGeo, { passive: true });

    initialStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();
