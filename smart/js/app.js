// js/app.js  (type="module")
// Никаких импортов fragment-load / register-sw / auth-status здесь нет!

function initPermissions() {
  const statusEl = document.getElementById("permStatus");
  const btnMic   = document.getElementById("btnMic");
  const btnCam   = document.getElementById("btnCam");
  const btnNoti  = document.getElementById("btnNoti");
  if (!statusEl || (!btnMic && !btnCam && !btnNoti)) return;

  import("/js/mic-permission.js").then(mod => {
    const { setStatusEl, bindMicPermissionButton, bindCameraPermissionButton, bindNotificationsButton } = mod;
    setStatusEl(statusEl);
    if (btnMic)  bindMicPermissionButton(btnMic, statusEl);
    if (btnCam)  bindCameraPermissionButton(btnCam, statusEl);
    if (btnNoti) bindNotificationsButton(btnNoti, statusEl);
  }).catch(console.error);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPermissions);
} else {
  initPermissions();
}
