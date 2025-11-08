// js/footer.js
(function () {
  // 1) Шаблон футера (минимально и аккуратно)
  function footerTemplate() {
    return `
      <div class="sv-footer">
        
        <div class="footer-inner">
        <div><a href="index.html">© 2025 Smart Vision</a></div>
        <div><a href="privacy.html">Политика конфиденциальности</a></div>
        <div><a href="terms.html">Условия использования</a></div>
          <div class="sv-footer__right" id="svFooterInfo"></div>
        </div>
      </div>
    `;
  }

  // 2) Вставка футера в #footer (или создание #footer при отсутствии)
  function mountFooter() {
    let root = document.getElementById("footer");
    if (!root) {
      root = document.createElement("footer");
      root.id = "footer";
      document.body.appendChild(root);
    }
    root.innerHTML = footerTemplate();

    // выставляем окружение (local/test/prod)
    const envEl = root.querySelector("#svEnv");
    if (envEl) {
      const h = location.host;
      envEl.textContent =
        /localhost|127\.0\.0\.1/.test(h) ? "local" :
        /test\./i.test(h)               ? "test"  : "prod";
    }
  }

  // 3) Публичный мини-API
  const SV = (window.SV = window.SV || {});
  SV.footer = {
    // вывод произвольного HTML/текста справа в футере
    setInfo(html) {
      const el = document.getElementById("svFooterInfo");
      if (el) el.innerHTML = html || "";
    }
  };

  // 4) Старт
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountFooter, { once: true });
  } else {
    mountFooter();
  }
})();
