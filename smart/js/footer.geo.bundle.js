/*
 * footer.geo.bundle.js
 * Self-contained footer with a geolocation widget.
 * Pure vanilla JS, no dependencies. Safe to include on any page.
 * Usage:
 *   <div id="app-footer"></div>
 *   <script src="/static/footer.geo.bundle.js"></script>
 *   <script>SVFooter.mount("app-footer");</script>
 *
 * Notes:
 * - Works only over HTTPS or http://localhost (browser requirement for Geolocation API).
 * - Nothing is sent to any server; everything stays in the browser.
 */

(function (global) {
  "use strict";

  var SVFooter = {};
  var GEO_LS_KEY = "sv:lastGeo";
  var _geoWatchId = null;
  var _geoLast = null; // {lat, lon, accuracy, timestamp}

  // ---------------- CSS ----------------
  var CSS = String.raw`
  .sv-footer{width:100%;border-top:1px solid #e2e8f0;background:rgba(255,255,255,.6);backdrop-filter:saturate(1.2) blur(6px)}
  .sv-footer__inner{max-width:1200px;margin:0 auto;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
  .sv-footer__section{display:flex;flex-direction:column;gap:4px;min-width:220px}
  .sv-footer__title{display:flex;align-items:center;gap:8px;font-weight:600;color:#0f172a;font-size:14px}
  .sv-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:9999px;font-size:12px}
  .sv-badge--tracking{background:#DCFCE7;color:#065F46}
  .sv-badge--granted{background:#E0F2FE;color:#075985}
  .sv-badge--denied,.sv-badge--error{background:#FFE4E6;color:#9F1239}
  .sv-badge--insecure{background:#FEF3C7;color:#92400E}
  .sv-badge--unsupported,.sv-badge--idle{background:#F1F5F9;color:#334155}
  .sv-footer__text{font-size:12px;color:#475569}
  .sv-dot{margin:0 6px;color:#94a3b8}
  .sv-footer__actions{display:flex;gap:8px;margin-top:4px}
  .sv-btn{padding:6px 12px;border-radius:12px;font-size:13px;cursor:pointer;user-select:none}
  .sv-btn--start{border:1px solid #cbd5e1;background:#fff;color:#334155}
  .sv-btn--stop{border:1px solid #fecaca;background:#fef2f2;color:#b91c1c}
  .sv-footer__small{font-size:11px;color:#94a3b8}
  a.sv-link{color:#0ea5e9;text-decoration:underline}
  a.sv-link:hover{text-decoration:none}
  `;

  // -------------- utils ---------------
  function injectCSS() {
    if (document.getElementById("sv-footer-css")) return;
    var style = document.createElement("style");
    style.id = "sv-footer-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function geoSupported() { return !!(navigator && navigator.geolocation); }
  function isSecureContextLike() {
    try {
      var host = location.hostname || "";
      var isLocal = /^(localhost|127\.0\.0\.1)$/.test(host);
      return isLocal || (location.protocol === "https:");
    } catch (_) { return false; }
  }
  function fmtAcc(m) {
    if (m == null) return "–";
    if (m < 1000) return "±" + Math.round(m) + " м";
    var km = m/1000;
    return "±" + (km >= 10 ? Math.round(km) : km.toFixed(1)) + " км";
  }
  function timeAgo(ts) {
    if (!ts) return "–";
    var diff = Date.now() - ts;
    var mins = Math.floor(diff/60000);
    if (mins < 1) return "только что";
    if (mins < 60) return mins + " мин назад";
    var hrs = Math.floor(mins/60);
    if (hrs < 24) return hrs + " ч назад";
    var d = Math.floor(hrs/24);
    return d + " дн назад";
  }
  function loadLastGeo() {
    try { var raw = localStorage.getItem(GEO_LS_KEY); return raw ? JSON.parse(raw) : null; } catch(_) { return null; }
  }
  function saveLastGeo(obj) {
    try { localStorage.setItem(GEO_LS_KEY, JSON.stringify(obj)); } catch(_) {}
  }

  function badge(state) {
    var map = {
      tracking: { cls: "sv-badge sv-badge--tracking", text: "● Отслеживается" },
      granted:  { cls: "sv-badge sv-badge--granted",  text: "✓ Разрешено" },
      denied:   { cls: "sv-badge sv-badge--denied",   text: "⨯ Запрещено" },
      error:    { cls: "sv-badge sv-badge--error",    text: "⚠ Ошибка" },
      insecure: { cls: "sv-badge sv-badge--insecure", text: "HTTPS нужен" },
      unsupported:{cls:"sv-badge sv-badge--unsupported", text:"Нет API" },
      idle:     { cls: "sv-badge sv-badge--idle",     text: "Готово" }
    };
    var s = map[state] || map.idle;
    return '<span class="'+s.cls+'">'+s.text+'</span>';
  }

  // -------------- rendering ---------------
  function footerTemplate() {
    return [
      '<div class="sv-footer">',
        '<div class="sv-footer__inner">',
          '<div class="sv-footer__section">',
            '<div class="sv-footer__title">SMART VISION</div>',
            '<div class="sv-footer__text">© ', new Date().getFullYear(), ' — Платформа</div>',
          '</div>',
          '<div class="sv-footer__section" id="svFooterGeo">',
            // geowidget renders here
          '</div>',
          '<div class="sv-footer__section">',
            '<div class="sv-footer__text">Сделано с ☕️ и JS</div>',
            '<div class="sv-footer__small">Ничего никуда не отправляем — все данные остаются у вас на устройстве.</div>',
          '</div>',
        '</div>',
      '</div>'
    ].join("");
  }

  function renderGeoUI(state) {
    var el = document.getElementById("svFooterGeo");
    if (!el) return;
    var coordHtml = "Координаты ещё не получены";

    if (_geoLast && typeof _geoLast.lat === "number" && typeof _geoLast.lon === "number") {
      var lat = _geoLast.lat.toFixed(6);
      var lon = _geoLast.lon.toFixed(6);
      var acc = fmtAcc(_geoLast.accuracy);
      var upd = timeAgo(_geoLast.timestamp);
      var gmaps = "https://maps.google.com/?q="+lat+","+lon;
      var osm   = "https://www.openstreetmap.org/?mlat="+lat+"&mlon="+lon+"#map=16/"+lat+"/"+lon;
      coordHtml =
        '<strong>'+lat+'</strong>, <strong>'+lon+'</strong>' +
        '<span class="sv-dot">•</span>точность '+acc +
        '<span class="sv-dot">•</span>обновлено '+upd +
        '<span class="sv-dot">•</span>' +
        '<a class="sv-link" href="'+gmaps+'" target="_blank" rel="noreferrer">Google Maps</a>' +
        '<span class="sv-dot">/</span>' +
        '<a class="sv-link" href="'+osm+'" target="_blank" rel="noreferrer">OSM</a>';
    }

    var canStart = (state === "idle" || state === "granted" || state === "denied");
    var canStop  = (state === "tracking");

    el.innerHTML = [
      '<div class="sv-footer__title">Геолокация ', badge(state), '</div>',
      '<div class="sv-footer__text">', coordHtml, '</div>',
      '<div class="sv-footer__actions">',
        (canStart ? '<button id="geoStartBtn" class="sv-btn sv-btn--start">Определить местоположение</button>' : ''),
        (canStop  ? '<button id="geoStopBtn"  class="sv-btn sv-btn--stop">Остановить</button>' : ''),
      '</div>',
      (state === "insecure" ? '<div class="sv-footer__small">Требуется HTTPS (или localhost).</div>' : ''),
      (state === "unsupported" ? '<div class="sv-footer__small">Браузер не поддерживает Geolocation API.</div>' : '')
    ].join("");

    var startBtn = document.getElementById("geoStartBtn");
    var stopBtn  = document.getElementById("geoStopBtn");
    if (startBtn) startBtn.addEventListener("click", requestGeolocationOnce, { once: true });
    if (stopBtn)  stopBtn.addEventListener("click", stopGeoWatch);
  }

  function setGeoStateAndRender(state) { renderGeoUI(state); }

  // -------------- geo logic ---------------
  function requestGeolocationOnce() {
    if (!geoSupported()) { setGeoStateAndRender("unsupported"); return; }
    if (!isSecureContextLike()) { setGeoStateAndRender("insecure"); return; }

    setGeoStateAndRender("idle");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var c = pos.coords || {};
        _geoLast = {
          lat: c.latitude,
          lon: c.longitude,
          accuracy: c.accuracy,
          timestamp: pos.timestamp
        };
        saveLastGeo(_geoLast);
        setGeoStateAndRender("granted");
        startGeoWatch(); // start watch after first success
      },
      function (err) {
        if (err && err.code === 1) setGeoStateAndRender("denied");
        else setGeoStateAndRender("error");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function startGeoWatch() {
    if (!geoSupported()) { setGeoStateAndRender("unsupported"); return; }
    if (!isSecureContextLike()) { setGeoStateAndRender("insecure"); return; }
    if (_geoWatchId != null) return;

    try {
      _geoWatchId = navigator.geolocation.watchPosition(
        function (pos) {
          var c = pos.coords || {};
          _geoLast = {
            lat: c.latitude,
            lon: c.longitude,
            accuracy: c.accuracy,
            timestamp: pos.timestamp
          };
          saveLastGeo(_geoLast);
          setGeoStateAndRender("tracking");
        },
        function (err) {
          if (err && err.code === 1) setGeoStateAndRender("denied");
          else setGeoStateAndRender("error");
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }
      );
      setGeoStateAndRender("tracking");
    } catch (_) {
      setGeoStateAndRender("error");
    }
  }

  function stopGeoWatch() {
    try {
      if (_geoWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
        navigator.geolocation.clearWatch(_geoWatchId);
      }
    } catch (_) {}
    _geoWatchId = null;
    setGeoStateAndRender("granted");
  }

  function initGeoWidget() {
    var saved = loadLastGeo();
    if (saved) _geoLast = saved;

    if (!geoSupported()) { setGeoStateAndRender("unsupported"); return; }
    if (!isSecureContextLike()) { setGeoStateAndRender("insecure"); return; }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(function (perm) {
        if (perm.state === "granted") {
          setGeoStateAndRender("granted");
          startGeoWatch();
        } else if (perm.state === "denied") {
          setGeoStateAndRender("denied");
        } else {
          setGeoStateAndRender("idle");
        }
        perm.onchange = function () {
          if (perm.state === "granted") startGeoWatch();
          else if (perm.state === "denied") stopGeoWatch();
          setGeoStateAndRender(perm.state === "granted" ? "granted" : (perm.state === "denied" ? "denied" : "idle"));
        };
      }).catch(function () {
        setGeoStateAndRender(_geoLast ? "granted" : "idle");
      });
    } else {
      setGeoStateAndRender(_geoLast ? "granted" : "idle");
    }
  }

  // -------------- public API ---------------
  SVFooter.mount = function mount(containerId) {
    injectCSS();
    var root = document.getElementById(containerId);
    if (!root) throw new Error('SVFooter.mount: container "' + containerId + '" not found');
    root.innerHTML = footerTemplate();
    initGeoWidget();
    window.addEventListener("beforeunload", function(){ try{ stopGeoWatch(); }catch(_){} });
  };

  // expose
  global.SVFooter = SVFooter;
})(window);
