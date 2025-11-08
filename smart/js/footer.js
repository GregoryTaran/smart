// js/footer.js — GES Footer (всё по центру, одной колонкой) + расширенная диагностика среды
/* eslint-disable no-var */
(function () {
  // ==========================
  // 0) Конфиг
  // ==========================
  var CONFIG = {
    brand: "Smart Vision • GES",
    links: [
      { label: "Главная", href: "index.html" },
      { label: "Политика конфиденциальности", href: "privacy.html" },
      { label: "Условия использования", href: "terms.html" }
    ],
    showBuildInfo: true,
    buildVersion: window.GES_BUILD_VERSION || "v1.0.0",
    showTime: true,
    showUserIds: true,
    idLabels: { user: "User ID", session: "Session ID", long: "Long ID (UUIDv4)" },
    voiceRecorderIntegration: true,
    ipApiUrl: "https://api.ipify.org?format=json",
    STR_NOT_DEFINED: "не определено",
    STR_DENIED: "пользователь не подтвердил",
    STR_NO: "отсутствует"
  };

  // ==========================
  // 1) Шаблон футера (одной колонкой)
  // ==========================
  function footerTemplate() {
    return (
      '<div class="sv-footer">' +
        '<div class="footer-inner" id="svFooterInner">' +
          '<div class="sv-footer__brand" id="svFooterBrand"></div>' +
          '<div class="sv-footer__links" id="svFooterLinks"></div>' +
          '<div class="sv-footer__env" id="svFooterEnv"></div>' +
          '<div class="sv-footer__time" id="svFooterTime"></div>' +
          '<div class="sv-footer__ids" id="svFooterInfo"></div>' +
        '</div>' +
      '</div>'
    );
  }

  // ==========================
  // 2) Монтирование
  // ==========================
  function mountFooter() {
    var root = document.getElementById("footer");
    if (!root) {
      root = document.createElement("footer");
      root.id = "footer";
      document.body.appendChild(root);
    }
    root.innerHTML = footerTemplate();

    // Базовая вертикальная колонка (подстраховка без CSS)
    var inner = document.getElementById("svFooterInner");
    if (inner) {
      inner.style.display = "flex";
      inner.style.flexDirection = "column";
      inner.style.alignItems = "center";
      inner.style.textAlign = "center";
      inner.style.gap = "6px";
    }

    renderBrand();
    renderLinks();
    renderEnv();
    renderTime();
    startClock();
    renderIds();
    syncVoiceRecorderBar();

    // Асинхронно собираем расширенную клиентскую информацию и добавляем ниже
    fetchAndRenderClientInfo();
  }

  // ==========================
  // 3) Бренд
  // ==========================
  function renderBrand() {
    var el = document.getElementById("svFooterBrand");
    if (el) el.textContent = CONFIG.brand;
  }

  // ==========================
  // 4) Ссылки
  // ==========================
  function renderLinks() {
    var el = document.getElementById("svFooterLinks");
    if (!el) return;
    var html = CONFIG.links.map(function (lnk) {
      return '<div class="sv-footer__link"><a href="' + encodeURI(lnk.href) + '">' + escapeHtml(lnk.label) + '</a></div>';
    }).join("");
    el.innerHTML = html;
  }

  // ==========================
  // 5) ENV / версия
  // ==========================
  function renderEnv() {
    var el = document.getElementById("svFooterEnv");
    if (!el) return;
    var host = location.hostname || "localhost";
    var isLocal = /^(localhost|127\.0\.0\.1)$/.test(host);
    var parts = [];
    parts.push(isLocal ? "ENV: local" : "ENV: production");
    if (CONFIG.showBuildInfo) parts.push("Build: " + CONFIG.buildVersion);
    el.innerHTML = parts.map(wrapRow).join("");
  }

  // ==========================
  // 6) Время (локальное)
  // ==========================
  var _clockTimer = null;
  function renderTime() {
    if (!CONFIG.showTime) return;
    var el = document.getElementById("svFooterTime");
    if (!el) return;
    var now = new Date();
    var s = now.getFullYear()+"-"+pad2(now.getMonth()+1)+"-"+pad2(now.getDate())+" "+pad2(now.getHours())+":"+pad2(now.getMinutes())+":"+pad2(now.getSeconds());
    el.innerHTML = wrapRow("Local time: " + s);
  }
  function startClock() { if (!_clockTimer && CONFIG.showTime) _clockTimer = setInterval(renderTime, 1000); }

  // ==========================
  // 7) Идентификаторы (ID)
  // ==========================
  var ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
  var MASK = (1 << 6) - 1;

  function rid(len) {
    if (len == null) len = 21;
    var b = new Uint8Array(len);
    crypto.getRandomValues(b);
    var out = "";
    for (var i = 0; i < len; i++) out += ALPHABET[b[i] & MASK];
    return out;
  }
  function uuidv4() {
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = [];
    for (var i = 0; i < 16; i++) hex.push((b[i] >>> 0).toString(16).padStart(2, "0"));
    return hex.slice(0,4).join("")+"-"+hex.slice(4,6).join("")+"-"+hex.slice(6,8).join("")+"-"+hex.slice(8,10).join("")+"-"+hex.slice(10,16).join("");
  }

  function getCookie(name) {
    var list = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < list.length; i++) {
      var kv = list[i].split("=");
      if (kv[0] === name) return decodeURIComponent(kv[1] || "");
    }
    return null;
  }
  function setCookie(name, value, days) {
    if (days == null) days = 400;
    var exp = new Date(Date.now() + days * 24 * 3600 * 1000).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + exp + "; path=/; samesite=Lax";
  }

  function getOrCreateUserId() {
    var id = getCookie("user_id") || safeLSget("user_id");
    if (!id) { id = rid(21); setCookie("user_id", id); safeLSset("user_id", id); }
    return id;
  }
  function getOrCreateSessionId() {
    var sid = safeSSget("session_id");
    if (!sid) { sid = rid(16); safeSSset("session_id", sid); }
    return sid;
  }
  function getOrCreateLongId() {
    var lid = safeLSget("long_id");
    if (!lid) { lid = uuidv4(); safeLSset("long_id", lid); }
    return lid;
  }

  function renderIds() {
    if (!CONFIG.showUserIds) return;
    var el = document.getElementById("svFooterInfo");
    if (!el) return;
    el.innerHTML = [
      row(CONFIG.idLabels.user, getOrCreateUserId()),
      row(CONFIG.idLabels.session, getOrCreateSessionId()),
      row(CONFIG.idLabels.long, getOrCreateLongId())
    ].join("");
  }

  // ==========================
  // 8) Интеграция с Voice Recorder
  // ==========================
  function syncVoiceRecorderBar() {
    if (!CONFIG.voiceRecorderIntegration) return;
    var anon = document.getElementById("anon-id");
    var sess = document.getElementById("session-id");
    var rec  = document.getElementById("recording-id");
    if (anon) anon.textContent = getOrCreateUserId();
    if (sess) sess.textContent = getOrCreateSessionId();
    if (rec && !rec.textContent.trim()) rec.textContent = "—";
  }

  // ==========================
  // 9) Клиентская инфо — сбор и рендер (мега-сводка)
  // ==========================
  function addFooterInfoRow(label, value) {
    try {
      var el = document.getElementById("svFooterInfo");
      if (!el) return;
      var rowHtml = row(label, value == null || value === "" ? CONFIG.STR_NOT_DEFINED : value);
      el.insertAdjacentHTML("beforeend", rowHtml);
    } catch (e) {}
  }

  async function fetchAndRenderClientInfo() {
    // --- User-Agent и brands
    try { addFooterInfoRow("User agent", navigator.userAgent || CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("User agent", CONFIG.STR_NOT_DEFINED); }
    try {
      if (navigator.userAgentData && navigator.userAgentData.brands) {
        var brands = navigator.userAgentData.brands.map(function(b){ return b.brand + " " + b.version; }).join(", ");
        addFooterInfoRow("UA brands", brands);
      } else {
        addFooterInfoRow("UA brands", CONFIG.STR_NOT_DEFINED);
      }
    } catch(e){ addFooterInfoRow("UA brands", CONFIG.STR_NOT_DEFINED); }

    // --- Browser (эвристика), Platform/Device/Context
    try { addFooterInfoRow("Browser", detectBrowser(navigator.userAgent) || CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Browser", CONFIG.STR_NOT_DEFINED); }
    try {
      var ctx = detectAppContextDetailed();
      addFooterInfoRow("Open context", ctx.context);
      addFooterInfoRow("Platform", ctx.platform);
      addFooterInfoRow("Device", ctx.device);
      addFooterInfoRow("Context hints", ctx.hints && ctx.hints.length ? ctx.hints.join("; ") : CONFIG.STR_NOT_DEFINED);
    } catch (e) {
      addFooterInfoRow("Open context", CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("Platform", CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("Device", CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("Context hints", CONFIG.STR_NOT_DEFINED);
    }

    // --- Языки, часовой пояс, смещение
    try { addFooterInfoRow("Language", navigator.language || CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Language", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Languages", (navigator.languages && navigator.languages.join(", ")) || CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Languages", CONFIG.STR_NOT_DEFINED); }
    try {
      var tz = Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Timezone", tz || CONFIG.STR_NOT_DEFINED);
    } catch (e) { addFooterInfoRow("Timezone", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Timezone offset (min)", String(new Date().getTimezoneOffset())); } catch(e){ addFooterInfoRow("Timezone offset (min)", CONFIG.STR_NOT_DEFINED); }

    // --- Экран/вьюпорт/цвета/DPR/ориентация/touch
    try { addFooterInfoRow("Screen", (screen && screen.width && screen.height) ? (screen.width + "x" + screen.height) : CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Screen", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Viewport", (window.innerWidth && window.innerHeight) ? (window.innerWidth + "x" + window.innerHeight) : CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Viewport", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Color depth", (screen && screen.colorDepth) ? screen.colorDepth : CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Color depth", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Pixel depth", (screen && screen.pixelDepth) ? screen.pixelDepth : CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Pixel depth", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Device pixel ratio", (typeof window.devicePixelRatio !== "undefined") ? String(window.devicePixelRatio) : CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Device pixel ratio", CONFIG.STR_NOT_DEFINED); }
    try {
      var o = (screen && screen.orientation && screen.orientation.type) || (window.matchMedia && (window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape")) || CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Orientation", o);
    } catch(e){ addFooterInfoRow("Orientation", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Touch points", (navigator.maxTouchPoints != null) ? String(navigator.maxTouchPoints) : CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Touch points", CONFIG.STR_NOT_DEFINED); }

    // --- CPU/RAM
    try { addFooterInfoRow("CPU threads", navigator.hardwareConcurrency || CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("CPU threads", CONFIG.STR_NOT_DEFINED); }
    try { addFooterInfoRow("Device memory (GB)", navigator.deviceMemory || CONFIG.STR_NOT_DEFINED); } catch(e){ addFooterInfoRow("Device memory (GB)", CONFIG.STR_NOT_DEFINED); }

    // --- Cookies/Storage
    try { addFooterInfoRow("Cookies enabled", navigator.cookieEnabled ? "yes" : "no"); } catch(e){ addFooterInfoRow("Cookies enabled", CONFIG.STR_NOT_DEFINED); }
    try {
      var lsAvail = (function(){ try{ localStorage.setItem("__probe__", "1"); localStorage.removeItem("__probe__"); return "available"; }catch(e){ return "unavailable"; }})();
      addFooterInfoRow("LocalStorage", lsAvail);
    } catch(e){ addFooterInfoRow("LocalStorage", "unavailable"); }
    try {
      var ssAvail = (function(){ try{ sessionStorage.setItem("__probe__", "1"); sessionStorage.removeItem("__probe__"); return "available"; }catch(e){ return "unavailable"; }})();
      addFooterInfoRow("SessionStorage", ssAvail);
    } catch(e){ addFooterInfoRow("SessionStorage", "unavailable"); }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var est = await navigator.storage.estimate();
        var quota = est.quota != null ? Math.round(est.quota/1024/1024) + " MB" : CONFIG.STR_NOT_DEFINED;
        var usage = est.usage != null ? Math.round(est.usage/1024/1024) + " MB" : CONFIG.STR_NOT_DEFINED;
        addFooterInfoRow("Storage quota", quota);
        addFooterInfoRow("Storage usage", usage);
        addFooterInfoRow("Persistent storage", (navigator.storage.persisted ? (await navigator.storage.persisted()) ? "persisted" : "not persisted" : CONFIG.STR_NOT_DEFINED));
      } else {
        addFooterInfoRow("Storage estimate", CONFIG.STR_NOT_DEFINED);
      }
    } catch(e){ addFooterInfoRow("Storage estimate", CONFIG.STR_NOT_DEFINED); }

    // --- Network / connection
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        addFooterInfoRow("Connection type", conn.effectiveType || CONFIG.STR_NOT_DEFINED);
        addFooterInfoRow("Downlink (Mb/s)", conn.downlink || CONFIG.STR_NOT_DEFINED);
        addFooterInfoRow("RTT (ms)", conn.rtt || CONFIG.STR_NOT_DEFINED);
        addFooterInfoRow("Save-Data", conn.saveData ? "on" : "off");
      } else {
        addFooterInfoRow("Connection", CONFIG.STR_NOT_DEFINED);
      }
    } catch (e) { addFooterInfoRow("Connection", CONFIG.STR_NOT_DEFINED); }

    // --- Battery
    try {
      if (navigator.getBattery) {
        try {
          var batt = await navigator.getBattery();
          addFooterInfoRow("Battery level", (typeof batt.level === "number") ? (Math.round(batt.level * 100) + "%") : CONFIG.STR_NOT_DEFINED);
          addFooterInfoRow("Battery charging", batt.charging ? "yes" : "no");
        } catch (e) { addFooterInfoRow("Battery", CONFIG.STR_NOT_DEFINED); }
      } else {
        addFooterInfoRow("Battery", CONFIG.STR_NOT_DEFINED);
      }
    } catch (e) { addFooterInfoRow("Battery", CONFIG.STR_NOT_DEFINED); }

    // --- Public IP
    try { addFooterInfoRow("Public IP", await fetchPublicIp(CONFIG.ipApiUrl) || CONFIG.STR_NOT_DEFINED); }
    catch (e) { addFooterInfoRow("Public IP", CONFIG.STR_NOT_DEFINED); }

    // --- Geolocation
    try {
      var geo = await getGeolocationSafe();
      if (geo && geo.error) {
        addFooterInfoRow("Geolocation", geo.error);
      } else if (geo && geo.coords) {
        addFooterInfoRow("Geolocation", "lat: " + geo.coords.latitude + ", lon: " + geo.coords.longitude + " (accuracy: " + (geo.coords.accuracy||"n/a") + "m)");
      } else {
        addFooterInfoRow("Geolocation", CONFIG.STR_NOT_DEFINED);
      }
    } catch (e) { addFooterInfoRow("Geolocation", CONFIG.STR_NOT_DEFINED); }

    // --- Media devices (суммарно по типам)
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          var devices = await navigator.mediaDevices.enumerateDevices();
          var counts = devices.reduce(function(acc, d){ acc[d.kind] = (acc[d.kind] || 0) + 1; return acc; }, {});
          addFooterInfoRow("Media devices", JSON.stringify(counts));
        } catch (e) { addFooterInfoRow("Media devices", CONFIG.STR_NOT_DEFINED); }
      } else { addFooterInfoRow("Media devices", CONFIG.STR_NO); }
    } catch (e) { addFooterInfoRow("Media devices", CONFIG.STR_NOT_DEFINED); }

    // --- Permissions API (статусы по ключевым разрешениям)
    try { await renderPermissionsStatus(); } catch(e){ addFooterInfoRow("Permissions", CONFIG.STR_NOT_DEFINED); }

    // --- Service Worker / Manifest / PWA признаки
    try { addFooterInfoRow("Service worker", ('serviceWorker' in navigator) ? (navigator.serviceWorker.controller ? "active" : "supported") : "unsupported"); } catch(e){ addFooterInfoRow("Service worker", CONFIG.STR_NOT_DEFINED); }
    try {
      var manifestLink = document.querySelector('link[rel="manifest"]');
      addFooterInfoRow("Web App Manifest", manifestLink ? (manifestLink.getAttribute("href") || "present") : CONFIG.STR_NO);
    } catch(e){ addFooterInfoRow("Web App Manifest", CONFIG.STR_NOT_DEFINED); }

    // --- Online/Offline
    try { addFooterInfoRow("Online", navigator.onLine ? "yes" : "no"); } catch(e){ addFooterInfoRow("Online", CONFIG.STR_NOT_DEFINED); }

    // --- Referrer / Navigation type
    try { addFooterInfoRow("Referrer", document.referrer || CONFIG.STR_NO); } catch(e){ addFooterInfoRow("Referrer", CONFIG.STR_NOT_DEFINED); }
    try {
      var nav = (performance && performance.getEntriesByType) ? performance.getEntriesByType("navigation")[0] : null;
      var navType = nav ? (nav.type || CONFIG.STR_NOT_DEFINED) : (performance && performance.navigation ? performance.navigation.type : CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("Navigation type", navType);
    } catch(e){ addFooterInfoRow("Navigation type", CONFIG.STR_NOT_DEFINED); }

    // --- WebGL / Renderer info
    try {
      var glInfo = getWebGLInfo();
      addFooterInfoRow("WebGL vendor", glInfo.vendor || CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("WebGL renderer", glInfo.renderer || CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("WebGL version", glInfo.version || CONFIG.STR_NOT_DEFINED);
    } catch(e){ addFooterInfoRow("WebGL", CONFIG.STR_NOT_DEFINED); }

    // --- AudioContext
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        var ac = new AC();
        addFooterInfoRow("Audio sampleRate", ac.sampleRate || CONFIG.STR_NOT_DEFINED);
        ac.close && ac.close();
      } else {
        addFooterInfoRow("Audio sampleRate", CONFIG.STR_NO);
      }
    } catch(e){ addFooterInfoRow("Audio sampleRate", CONFIG.STR_NOT_DEFINED); }

    // --- Canvas support (как хинт)
    try { addFooterInfoRow("Canvas support", !!window.HTMLCanvasElement ? "yes" : "no"); } catch(e){ addFooterInfoRow("Canvas support", CONFIG.STR_NOT_DEFINED); }
  }

  // ==========================
  // Helpers: IP, Geolocation, Permissions, WebGL, Context, Browser
  // ==========================
  async function fetchPublicIp(apiUrl) {
    try {
      var res = await fetch(apiUrl, {cache: "no-store"});
      if (!res.ok) return null;
      var j = await res.json();
      return j && j.ip ? j.ip : null;
    } catch (e) { return null; }
  }

  function getGeolocationSafe() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve({ error: CONFIG.STR_NO });
      var called = false;
      var opts = { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 };
      navigator.geolocation.getCurrentPosition(
        function (pos) { if (!called) { called = true; resolve({ coords: pos.coords }); } },
        function (err) {
          if (!called) { called = true;
            if (err && err.code === 1) resolve({ error: CONFIG.STR_DENIED });
            else resolve({ error: CONFIG.STR_NOT_DEFINED });
          }
        },
        opts
      );
      setTimeout(function () { if (!called) { called = true; resolve({ error: CONFIG.STR_NOT_DEFINED }); } }, 6000);
    });
  }

  async function renderPermissionsStatus() {
    if (!navigator.permissions || !navigator.permissions.query) {
      addFooterInfoRow("Permissions", "API unavailable");
      return;
    }
    var names = [
      "geolocation",
      "notifications",
      "camera",
      "microphone",
      "persistent-storage",
      "push",
      "clipboard-read",
      "clipboard-write"
    ];
    for (var i=0; i<names.length; i++) {
      var name = names[i];
      try {
        var st = await navigator.permissions.query({ name: name });
        addFooterInfoRow("Permission: " + name, st.state || CONFIG.STR_NOT_DEFINED); // granted/denied/prompt
      } catch (e) {
        addFooterInfoRow("Permission: " + name, CONFIG.STR_NOT_DEFINED);
      }
    }
  }

  function getWebGLInfo() {
    var info = { vendor: null, renderer: null, version: null };
    try {
      var canvas = document.createElement("canvas");
      var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return info;
      info.version = gl.getParameter(gl.VERSION);
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        info.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        info.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      } else {
        info.vendor = gl.getParameter(gl.VENDOR);
        info.renderer = gl.getParameter(gl.RENDERER);
      }
    } catch (e) {}
    return info;
    }

  function detectBrowser(ua) {
    if (!ua) return null;
    var s = ua.toLowerCase();
    if (s.indexOf("chrome") !== -1 && s.indexOf("edg") === -1 && s.indexOf("opr") === -1) return "Chrome";
    if (s.indexOf("safari") !== -1 && s.indexOf("chrome") === -1) return "Safari";
    if (s.indexOf("firefox") !== -1) return "Firefox";
    if (s.indexOf("edg") !== -1) return "Edge";
    if (s.indexOf("opr") !== -1 || s.indexOf("opera") !== -1) return "Opera";
    if (s.indexOf("msie") !== -1 || s.indexOf("trident") !== -1) return "Internet Explorer";
    return "Unknown";
  }

  function detectAppContextDetailed() {
    var result = { context: "browser", platform: "unknown", device: "unknown", hints: [] };
    var uaRaw = navigator.userAgent || "";
    var ua = uaRaw.toLowerCase();

    // Платформа
    var isAndroid = /android/.test(ua);
    var isIOS = /(iphone|ipad|ipod)/.test(ua) || /cpu iphone os/.test(ua);
    result.platform = isAndroid ? "android" : isIOS ? "ios" : /mac os|windows|linux/.test(ua) ? "desktop" : "unknown";

    // Устройство
    var uaDataMobile = navigator.userAgentData && navigator.userAgentData.mobile;
    if (uaDataMobile === true) result.device = "mobile";
    else if (/ipad/.test(ua)) result.device = "tablet";
    else if (isAndroid && !/mobile/.test(ua)) result.device = "tablet";
    else if (/mobile/.test(ua)) result.device = "mobile";
    else result.device = (screen && screen.width >= 1024 && (navigator.maxTouchPoints || 0) < 2) ? "desktop" : "unknown";

    // PWA / standalone
    var isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    if (isStandalone) { result.context = "pwa"; result.hints.push("display-mode: standalone"); }

    // TWA
    if (document.referrer && document.referrer.startsWith("android-app://")) {
      result.context = "twa";
      result.hints.push("referrer: android-app://");
    }

    // WebView / бриджи
    var hasRN = typeof window.ReactNativeWebView !== "undefined";
    var hasAndroidBridge = typeof window.Android !== "undefined";
    var hasWebkitBridge = typeof (window.webkit && window.webkit.messageHandlers) !== "undefined";
    var isAndroidWV = isAndroid && (ua.indexOf("; wv") !== -1 || ua.indexOf(" version/") !== -1);
    var isIOSWV = isIOS && ua.indexOf("safari") === -1;

    if (hasRN) { result.context = "react-native"; result.hints.push("ReactNativeWebView"); }
    else if (hasAndroidBridge) { result.context = "android-bridge"; result.hints.push("Android bridge"); }
    else if (isAndroidWV || isIOSWV || hasWebkitBridge) {
      result.context = "webview";
      if (isAndroidWV) result.hints.push("Android WebView (; wv / Version/)");
      if (isIOSWV) result.hints.push("iOS WebView (no Safari token)");
      if (hasWebkitBridge) result.hints.push("webkit.messageHandlers");
    }

    // In-app браузеры соцсетей
    var inApps = [
      { key: "facebook",   re: /(fban|fbav)/ },
      { key: "instagram",  re: /instagram/ },
      { key: "tiktok",     re: /tiktok/ },
      { key: "snapchat",   re: /snapchat/ },
      { key: "wechat",     re: /micromessenger/ },
      { key: "kakaotalk",  re: /kakaotalk/ },
      { key: "line",       re: / line\// }
    ];
    for (var i=0; i<inApps.length; i++) {
      if (inApps[i].re.test(ua)) {
        result.context = "in-app";
        result.hints.push("in-app: " + inApps[i].key);
      }
    }

    // URL-маркеры от нативного приложения
    try {
      var p = new URL(location.href).searchParams;
      var source = p.get("app") || p.get("source");
      if (source) result.hints.push("URL param: " + source);
    } catch (_) {}

    if (document.referrer) result.hints.push("referrer: " + document.referrer);

    return result;
  }

  // ==========================
  // 10) Публичный API (совместимость)
  // ==========================
  var SV = (window.SV = window.SV || {});
  SV.footer = {
    setInfo: function (html) {
      var el = document.getElementById("svFooterInfo");
      if (el) el.innerHTML = html || "";
    },
    getIds: function () {
      return {
        userId: getOrCreateUserId(),
        sessionId: getOrCreateSessionId(),
        longId: getOrCreateLongId()
      };
    }
  };

  // ==========================
  // A) Утилиты
  // ==========================
  function row(label, value) {
    return wrapRow("<strong>" + escapeHtml(label) + ":</strong> <code>" + escapeHtml(String(value)) + "</code>");
  }
  function wrapRow(innerHtml) { return '<div class="sv-row">' + innerHtml + "</div>"; }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function escapeHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function safeLSget(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function safeLSset(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  function safeSSget(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } }
  function safeSSset(k,v){ try{ sessionStorage.setItem(k,v); }catch(e){} }

  // ==========================
  // Z) Запуск
  // ==========================
  function start(){ mountFooter(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
