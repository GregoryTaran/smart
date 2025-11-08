// js/footer.js — GES Footer (всё по центру, одной колонкой, со старыми ссылками)
// + дополнение: сбор и показ максимально возможной клиентской информации
/* eslint-disable no-var */
(function () {
  // ==========================
  // 0) Конфиг
  // ==========================
  var CONFIG = {
    brand: "Smart Vision • GES",
    // Оставляем твои ссылки (можно править порядок/названия/URL):
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
    // URL для получения публичного IP (можно заменить, если нужен другой сервис)
    ipApiUrl: "https://api.ipify.org?format=json",
    // подписи для "не удалось" / "не определено"
    STR_NOT_DEFINED: "не определено",
    STR_DENIED: "пользователь не подтвердил",
    STR_NO: "отсутствует"
  };

  // ==========================
  // 1) Шаблон футера (всё — одной колонкой)
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

    // Базовая вертикальная колонка (если нет CSS)
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

    // асинхронно собираем остальную клиентскую инфу и добавляем её ниже
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
  // 4) Ссылки (твои «три надписи»)
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
  // 7) Идентификаторы
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
  // 9) Клиентская инфо — сбор и рендер
  // ==========================
  // Помощник: добавляет строку в svFooterInfo (append)
  function addFooterInfoRow(label, value) {
    try {
      var el = document.getElementById("svFooterInfo");
      if (!el) return;
      var rowHtml = row(label, value == null ? CONFIG.STR_NOT_DEFINED : value);
      el.insertAdjacentHTML("beforeend", rowHtml);
    } catch (e) {
      // тихо игнорируем ошибки
    }
  }

  // Основная асинхронная функция, пытается достать всё, что возможно
  async function fetchAndRenderClientInfo() {
    // Сначала общая информация (синхронно)
    try {
      var ua = navigator.userAgent || CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("User agent", ua);
    } catch (e) { addFooterInfoRow("User agent", CONFIG.STR_NOT_DEFINED); }

    // Простая парсинг браузера/платформы (эвристика)
    try {
      var browser = detectBrowser(navigator.userAgent);
      addFooterInfoRow("Browser", browser || CONFIG.STR_NOT_DEFINED);
    } catch (e) { addFooterInfoRow("Browser", CONFIG.STR_NOT_DEFINED); }

    try {
      var platform = navigator.platform || CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Platform", platform);
    } catch (e) { addFooterInfoRow("Platform", CONFIG.STR_NOT_DEFINED); }

    try {
      var lang = navigator.language || CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Language", lang);
    } catch (e) { addFooterInfoRow("Language", CONFIG.STR_NOT_DEFINED); }

    try {
      var tz = Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Timezone", tz || CONFIG.STR_NOT_DEFINED);
    } catch (e) { addFooterInfoRow("Timezone", CONFIG.STR_NOT_DEFINED); }

    try {
      var screenSize = (screen && screen.width && screen.height) ? screen.width + "x" + screen.height : CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Screen", screenSize);
    } catch (e) { addFooterInfoRow("Screen", CONFIG.STR_NOT_DEFINED); }

    try {
      var dpr = (typeof window.devicePixelRatio !== "undefined") ? String(window.devicePixelRatio) : CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Device pixel ratio", dpr);
    } catch (e) { addFooterInfoRow("Device pixel ratio", CONFIG.STR_NOT_DEFINED); }

    try {
      var hw = (navigator.hardwareConcurrency || CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("CPU threads", hw);
    } catch (e) { addFooterInfoRow("CPU threads", CONFIG.STR_NOT_DEFINED); }

    try {
      var ram = (navigator.deviceMemory || CONFIG.STR_NOT_DEFINED);
      addFooterInfoRow("Device memory (GB)", ram);
    } catch (e) { addFooterInfoRow("Device memory (GB)", CONFIG.STR_NOT_DEFINED); }

    try {
      addFooterInfoRow("Cookies enabled", navigator.cookieEnabled ? "yes" : "no");
    } catch (e) { addFooterInfoRow("Cookies enabled", CONFIG.STR_NOT_DEFINED); }

    try {
      var dnt = (navigator.doNotTrack || navigator.msDoNotTrack) || CONFIG.STR_NOT_DEFINED;
      addFooterInfoRow("Do Not Track", dnt);
    } catch (e) { addFooterInfoRow("Do Not Track", CONFIG.STR_NOT_DEFINED); }

    try {
      addFooterInfoRow("LocalStorage", !!safeLSget("__probe__") ? "available" : (function(){ try{ localStorage.setItem("__probe__", "1"); localStorage.removeItem("__probe__"); return "available"; }catch(e){return "unavailable";}})());
    } catch (e) { addFooterInfoRow("LocalStorage", "unavailable"); }

    try {
      addFooterInfoRow("SessionStorage", !!safeSSget("__probe__") ? "available" : (function(){ try{ sessionStorage.setItem("__probe__", "1"); sessionStorage.removeItem("__probe__"); return "available"; }catch(e){return "unavailable";}})());
    } catch (e) { addFooterInfoRow("SessionStorage", "unavailable"); }

    // Network / connection
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        addFooterInfoRow("Connection type", conn.effectiveType || CONFIG.STR_NOT_DEFINED);
        addFooterInfoRow("Downlink (Mb/s)", conn.downlink || CONFIG.STR_NOT_DEFINED);
        addFooterInfoRow("RTT (ms)", conn.rtt || CONFIG.STR_NOT_DEFINED);
      } else {
        addFooterInfoRow("Connection", CONFIG.STR_NOT_DEFINED);
      }
    } catch (e) { addFooterInfoRow("Connection", CONFIG.STR_NOT_DEFINED); }

    // Battery (may be promise)
    try {
      if (navigator.getBattery) {
        try {
          var batt = await navigator.getBattery();
          addFooterInfoRow("Battery level", (typeof batt.level === "number") ? (Math.round(batt.level * 100) + "%") : CONFIG.STR_NOT_DEFINED);
          addFooterInfoRow("Battery charging", batt.charging ? "yes" : "no");
        } catch (e) {
          addFooterInfoRow("Battery", CONFIG.STR_NOT_DEFINED);
        }
      } else {
        addFooterInfoRow("Battery", CONFIG.STR_NOT_DEFINED);
      }
    } catch (e) { addFooterInfoRow("Battery", CONFIG.STR_NOT_DEFINED); }

    // IP — через внешний API (нужен запрос)
    try {
      var ip = await fetchPublicIp(CONFIG.ipApiUrl);
      addFooterInfoRow("Public IP", ip || CONFIG.STR_NOT_DEFINED);
    } catch (e) {
      addFooterInfoRow("Public IP", CONFIG.STR_NOT_DEFINED);
    }

    // Geolocation — запрашиваем, но если отказ — помечаем
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

    // Media devices availability (enumerateDevices) — без разрешения можно увидеть только типы
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          var devices = await navigator.mediaDevices.enumerateDevices();
          var counts = devices.reduce(function(acc, d){ acc[d.kind] = (acc[d.kind] || 0) + 1; return acc; }, {});
          addFooterInfoRow("Media devices", JSON.stringify(counts));
        } catch (e) {
          addFooterInfoRow("Media devices", CONFIG.STR_NOT_DEFINED);
        }
      } else {
        addFooterInfoRow("Media devices", CONFIG.STR_NO);
      }
    } catch (e) { addFooterInfoRow("Media devices", CONFIG.STR_NOT_DEFINED); }

    // Detect if open inside app / webview / PWA
    try {
      var appInfo = detectAppContext();
      addFooterInfoRow("Open context", appInfo);
    } catch (e) { addFooterInfoRow("Open context", CONFIG.STR_NOT_DEFINED); }

    // Fingerprint hint (simple) — we won't use heavy libs; show canvas support as hint
    try {
      var canvasSupport = !!window.HTMLCanvasElement;
      addFooterInfoRow("Canvas support", canvasSupport ? "yes" : "no");
    } catch (e) { addFooterInfoRow("Canvas support", CONFIG.STR_NOT_DEFINED); }

    // Done
  }

  // ==========================
  // Helper: fetch public IP
  // ==========================
  async function fetchPublicIp(apiUrl) {
    try {
      var res = await fetch(apiUrl, {cache: "no-store"});
      if (!res.ok) return null;
      var j = await res.json();
      return j && j.ip ? j.ip : null;
    } catch (e) {
      return null;
    }
  }

  // ==========================
  // Helper: safe geolocation (wrap in promise)
  // ==========================
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
      // safety timeout
      setTimeout(function () { if (!called) { called = true; resolve({ error: CONFIG.STR_NOT_DEFINED }); } }, 6000);
    });
  }

  // ==========================
  // Helper: detect simple browser from UA (very lightweight)
  // ==========================
  function detectBrowser(ua) {
    if (!ua) return null;
    ua = ua.toLowerCase();
    if (ua.indexOf("chrome") !== -1 && ua.indexOf("edg") === -1 && ua.indexOf("opr") === -1) return "Chrome";
    if (ua.indexOf("safari") !== -1 && ua.indexOf("chrome") === -1) return "Safari";
    if (ua.indexOf("firefox") !== -1) return "Firefox";
    if (ua.indexOf("edg") !== -1) return "Edge";
    if (ua.indexOf("opr") !== -1 || ua.indexOf("opera") !== -1) return "Opera";
    if (ua.indexOf("msie") !== -1 || ua.indexOf("trident") !== -1) return "Internet Explorer";
    return "Unknown";
  }

  // ==========================
  // Helper: detect app / PWA / WebView / native bridges (heuristics)
  // ==========================
  function detectAppContext() {
    try {
      var ua = navigator.userAgent || "";
      var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
      var hasReactNativeBridge = typeof window.ReactNativeWebView !== "undefined";
      var hasAndroidBridge = typeof window.Android !== "undefined";
      var isWebView = /wv/.test(ua) || /webview/.test(ua) || /; wv\)/.test(ua) || /; wv;/.test(ua);
      var schemeParam = (function() {
        try {
          var p = new URL(location.href).searchParams;
          return p.get("app") || p.get("source");
        } catch(e){ return null; }
      })();

      var parts = [];
      if (isStandalone) parts.push("PWA / standalone");
      if (hasReactNativeBridge) parts.push("ReactNativeWebView");
      if (hasAndroidBridge) parts.push("Android bridge");
      if (isWebView) parts.push("WebView (probably embedded)");
      if (schemeParam) parts.push("URL param: " + schemeParam);
      if (document.referrer) parts.push("referrer: " + document.referrer);
      if (!parts.length) return "regular browser";
      return parts.join("; ");
    } catch (e) {
      return CONFIG.STR_NOT_DEFINED;
    }
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
