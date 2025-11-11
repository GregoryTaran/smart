/* js/footer.js — простой центрированный футер */
(function () {
  function ensureRoot() {
    var el = document.getElementById("footer");
    if (!el) {
      el = document.createElement("footer");
      el.id = "footer";
      document.body.appendChild(el);
    }
    return el;
  }

  function render() {
    var root = ensureRoot();
    root.innerHTML =
      '<div class="sv-footer" role="contentinfo" aria-label="Footer" ' +
        'style="display:flex;flex-direction:column;align-items:center;gap:6px;margin:24px 0;text-align:center;">' +
        '<div>•&nbsp; Smart Vision &nbsp;•</div>' +
        '<div><a href="index.html" style="text-decoration:none;">Главная</a></div>' +
        '<div><a href="./privacy/privacy.html" style="text-decoration:none;">Политика конфиденциальности</a></div>' +
        '<div><a href="./terms/terms.html" style="text-decoration:none;">Условия использования</a></div>' +
      '</div>';
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
