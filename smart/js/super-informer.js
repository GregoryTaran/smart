// =======================================
// SUPER INFORMER (чистая диагностическая панель)
// SMART VISION — 2025
// =======================================

export async function collectSuperInfo() {

  // ------------ 1. SESSION (новая система) ---------------
  const session = window.SMART_SESSION || {
    authenticated: false,
    user_id: null,
    email: null,
    name: null,
    level: 1
  };

  // ------------ 2. Public IP ---------------
  let publicIP = null;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    publicIP = (await res.json()).ip;
  } catch {
    publicIP = "unavailable";
  }

  // ------------ 3. Permissions ---------------
  async function perm(name) {
    try {
      const p = await navigator.permissions.query({ name });
      return p.state;
    } catch {
      return "unsupported";
    }
  }

  const permissions = {
    geolocation: await perm("geolocation"),
    microphone: await perm("microphone"),
    camera: await perm("camera"),
    notifications: await perm("notifications"),
  };

  // ------------ 4. Battery ---------------
  let battery = null;
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      battery = {
        charging: b.charging,
        level: b.level,
      };
    }
  } catch {
    battery = "unavailable";
  }

  // ------------ 5. Storage ----------------
  let storage = {};
  try {
    if (navigator.storage?.estimate) {
      storage = await navigator.storage.estimate();
    }
  } catch {}

  // ------------ 6. Device ----------------
  const device = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages,
    memory: navigator.deviceMemory || null,
    cores: navigator.hardwareConcurrency || null,
    touchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    darkMode: matchMedia("(prefers-color-scheme: dark)").matches,
  };

  // ------------ 7. Screen ----------------
  const screenInfo = {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    pixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };

  // ------------ 8. Network ----------------
  const net = navigator.connection || {};
  const network = {
    online: navigator.onLine,
    effectiveType: net.effectiveType || null,
    downlink: net.downlink || null,
    rtt: net.rtt || null,
  };

  // ------------ 9. GPU (безопасный) ----------------
  function getGPU() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl");
      if (!gl) return "unsupported";

      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : "hidden",
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "hidden"
      };
    } catch {
      return "unavailable";
    }
  }

  const gpu = getGPU();

  // ------------ 10. Final ----------------
  return {
    session,
    publicIP,
    permissions,
    battery,
    device,
    screen: screenInfo,
    storage,
    gpu,
    network,
    timestamp: new Date().toISOString()
  };
}
