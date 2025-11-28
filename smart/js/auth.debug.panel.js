// AUTH DEBUG PANEL — SMART VISION

(function () {
  const isDebug =
    location.search.includes("debug=1") ||
    localStorage.getItem("sv.debug.auth") === "1";

  if (!isDebug) return;

  function createPanel() {
    const box = document.createElement("div");
    box.id = "sv-auth-panel";
    box.style.position = "fixed";
    box.style.bottom = "20px";
    box.style.right = "20px";
    box.style.width = "280px";
    box.style.maxHeight = "80vh";
    box.style.overflowY = "auto";
    box.style.padding = "12px";
    box.style.background = "rgba(255,255,255,0.97)";
    box.style.border = "1px solid #ccc";
    box.style.borderRadius = "12px";
    box.style.boxShadow = "0 4px 30px rgba(0,0,0,0.15)";
    box.style.fontSize = "13px";
    box.style.zIndex = "99999";
    box.style.color = "#111";
    box.style.backdropFilter = "blur(6px)";

    box.innerHTML = `
      <b style="font-size:15px;">AUTH PANEL</b>
      <div id="sv-auth-content" style="margin-top:10px; white-space:pre-wrap;"></div>

      <div style="margin-top:12px; display:flex; gap:6px; flex-wrap:wrap;">
        <button data-action="me" class="svdbg-btn">/me</button>
        <button data-action="logout" class="svdbg-btn">Logout</button>
        <button data-action="cache" class="svdbg-btn">Clear cache</button>
      </div>
    `;

    document.body.appendChild(box);

    document.querySelectorAll(".svdbg-btn").forEach(btn => {
      btn.style.padding = "6px 10px";
      btn.style.fontSize = "12px";
      btn.style.border = "1px solid #999";
      btn.style.borderRadius = "8px";
      btn.style.background = "#fff";
      btn.style.cursor = "pointer";

      btn.addEventListener("click", handleAction);
    });

    refreshPanel();
  }

  async function handleAction(e) {
    const act = e.target.dataset.action;

    if (act === "me") {
      refreshPanel(true);
    }

    if (act === "logout") {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
      refreshPanel(true);
    }

    if (act === "cache") {
      localStorage.removeItem("sv.auth.cache.v1");
      refreshPanel(true);
    }
  }

  async function refreshPanel(forceMe = false) {
    const info = {};

    // session из smartid.init
    info.session = window.SMART_SESSION || {};

    // cookies
    info.cookies = document.cookie.split(";").map(x => x.trim());

    // /me
    if (forceMe) {
      info.me = await fetch("/api/auth/me", {
        credentials: "include"
      }).then(r => r.json());
    }

    const content = JSON.stringify(info, null, 2);
    document.getElementById("sv-auth-content").textContent = content;
  }

  createPanel();
})();
