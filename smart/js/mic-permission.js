// /js/mic-permission.js
// SMART VISION — единый помощник разрешений (браузер + WebView)
// API:
//   setStatusEl(el?)         — опционально: элемент для статусов
//   ensureMic()              — запросить доступ к микрофону
//   ensureCamera()           — запросить доступ к камере
//   ensureNotifications()    — запросить доступ к уведомлениям (браузерные)
//   bind...Button(btn, el?)  — привязки к кнопкам (удобные шорткаты)

export const isCapacitor =
  !!(globalThis?.Capacitor) ||
  /; wv\)|Capacitor|Android.*(wv|Version\/\d+\.\d+).*Chrome/i.test(navigator.userAgent);

let _statusEl = null;
export function setStatusEl(el) { _statusEl = el || null; }
function _status(msg) { if (_statusEl) _statusEl.textContent = msg; }

async function queryPerm(name) {
  try {
    if (navigator.permissions?.query) {
      const p = await navigator.permissions.query({ name });
      return p.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch {}
  return 'unknown';
}

function normalizeErr(e) {
  const name = e?.name || e?.message || String(e);
  if (name.includes('NotAllowed')) return 'not_allowed';
  if (name.includes('NotFound'))  return 'no_device';
  if (name.includes('Security'))  return 'security';
  return 'unknown';
}

/* ---------- MIC ---------- */
export async function ensureMic() {
  const state = await queryPerm('microphone');
  if (state === 'granted') { _status('microphone: granted'); return { ok:true, state }; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
    });
    stream.getTracks().forEach(t=>t.stop());
    _status('microphone: granted');
    return { ok:true, state:'granted' };
  } catch (e) {
    const reason = normalizeErr(e);
    _status(reason === 'not_allowed' ? 'microphone: denied' :
            reason === 'no_device'    ? 'microphone: device not found' :
            reason === 'security'     ? 'microphone: security error' :
                                        'microphone: error');
    if (isCapacitor && reason === 'not_allowed') {
      console.warn('Tip: App Info → Permissions → enable Microphone for SMART VISION');
    }
    return { ok:false, reason, error:e };
  }
}

/* ---------- CAMERA ---------- */
export async function ensureCamera() {
  const state = await queryPerm('camera');
  if (state === 'granted') { _status('camera: granted'); return { ok:true, state }; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video:true });
    stream.getTracks().forEach(t=>t.stop());
    _status('camera: granted');
    return { ok:true, state:'granted' };
  } catch (e) {
    const reason = normalizeErr(e);
    _status(reason === 'not_allowed' ? 'camera: denied' :
            reason === 'no_device'    ? 'camera: device not found' :
            reason === 'security'     ? 'camera: security error' :
                                        'camera: error');
    if (isCapacitor && reason === 'not_allowed') {
      console.warn('Tip: App Info → Permissions → enable Camera for SMART VISION');
    }
    return { ok:false, reason, error:e };
  }
}

/* ---------- NOTIFICATIONS (Web) ---------- */
export async function ensureNotifications() {
  // Поддержка браузерных уведомлений (в WebView Android часто ограничена без плагинов)
  if (!('Notification' in window)) {
    _status('notifications: not supported');
    return { ok:false, reason:'unsupported' };
  }
  if (Notification.permission === 'granted') {
    _status('notifications: granted');
    return { ok:true, state:'granted' };
  }
  if (Notification.permission === 'denied') {
    _status('notifications: denied');
    return { ok:false, reason:'denied' };
  }
  // Требует жест пользователя
  try {
    const perm = await Notification.requestPermission();
    const ok = (perm === 'granted');
    _status(`notifications: ${perm}`);
    return { ok, state:perm };
  } catch (e) {
    _status('notifications: error');
    return { ok:false, reason:'error', error:e };
  }
}

/* ---------- Helpers to bind buttons ---------- */
export function bindMicPermissionButton(btn, el) {
  if (el) setStatusEl(el);
  btn?.addEventListener('click', async ()=>{ await ensureMic(); }, { passive:true });
}
export function bindCameraPermissionButton(btn, el) {
  if (el) setStatusEl(el);
  btn?.addEventListener('click', async ()=>{ await ensureCamera(); }, { passive:true });
}
export function bindNotificationsButton(btn, el) {
  if (el) setStatusEl(el);
  btn?.addEventListener('click', async ()=>{ await ensureNotifications(); }, { passive:true });
}
