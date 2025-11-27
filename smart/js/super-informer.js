// super-informer.js
// Мощная диагностическая панель (замена identity-guard.js)

export async function collectSuperInfo() {

  // 1) SV_AUTH — твоя основная система
  const svAuth = window.SV_AUTH || {};

  // 2) Public IP
  let publicIP = null;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const ipData = await res.json();
    publicIP = ipData.ip;
  } catch {}

  // 3) Permissions
  async function checkPerm(name) {
    try {
      const p = await navigator.permissions.query({ name });
      return p.state;
    } catch {
      return "unsupported";
    }
  }

  const permissions = {
    geolocation: await checkPerm("geolocation"),
    microphone: await checkPerm("microphone"),
    camera: await checkPerm("camera"),
    notifications: await checkPerm("notifications"),
    clipboard: await checkPerm("clipboard-read")
  };

  // 4) Battery
  let battery = null;
  if (navigator.getBattery) {
    try {
      battery = await navigator.getBattery();
      battery = {
        charging: battery.charging,
        level: battery.level,
      };
    } catch {}
  }

  // 5) Storage usage
  let storage = {};
  if (navigator.storage && navigator.storage.estimate) {
    try { storage = await navigator.storage.estimate(); } catch {}
  }

  // 6) WebGL Renderer (GPU)
  function getWebGLInfo() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return null;
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
      };
    } catch (e) {
      return null;
    }
  }

  // 7) Network
  const net = navigator.connection || navigator.webkitConnection || navigator.mozConnection || {};

  // 8) Device info
  const device = {
    userAgent: navigator.userAgent,
    brands: navigator.userAgentData?.brands || null,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages,
    memory: navigator.deviceMemory || null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    cookieEnabled: navigator.cookieEnabled,
    touchPoints: navigator.maxTouchPoints,
    darkMode: window.matchMedia("(prefers-color-scheme: dark)").matches,
  };

  // 9) Screen
  const screenInfo = {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    pixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };

  // 10) WebGL
  const webgl = getWebGLInfo();

  // 11) Final object
  return {
    svAuth,
    publicIP,
    permissions,
    battery,
    device,
    screen: screenInfo,
    storage,
    webgl,
    network: {
      effectiveType: net.effectiveType,
      downlink: net.downlink,
      rtt: net.rtt,
      online: navigator.onLine,
    },
    timestamp: new Date().toISOString()
  };
}
