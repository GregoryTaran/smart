// ======== Context.js (v1.1 — авто-высота) ========
const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
let ws, audioCtx, worklet, stream;
let buffer = [];
let total = 0;
let lastSend = 0;
let sampleRate = 44100;
let sessionId = null;
const logEl = document.getElementById("log");

function log(msg) {
  const linked = msg.replace(
    /(https?:\/\/[^\s]+)/g,
    (url) => '<a href="' + url + '" target="_blank">' + url + "</a>"
  );
  const line = document.createElement("div");
  line.innerHTML = linked;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
  // ✅ каждые изменения высоты отправляем родителю
  sendHeight();
}

function logLink(prefix, url, text) {
  const line = document.createElement("div");
  line.append(document.createTextNode(prefix + " "));
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.textContent = text;
  line.appendChild(a);
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(prefix + " " + url);
  sendHeight();
}

// ... остальной код без изменений ...

// ✅ добавляем авто-высоту
function sendHeight() {
  if (window.parent !== window) {
    const h = document.body.scrollHeight;
    window.parent.postMessage({ type: "contextHeight", height: h }, "*");
  }
}
window.addEventListener("load", sendHeight);
new ResizeObserver(sendHeight).observe(document.body);
