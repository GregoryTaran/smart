/* SMART VISION — menu-state.js (deterministic) */
(function () {
  const LS_AUTH="sv_auth", LS_USER="sv_user", LS_USER_RAW="sv_user_raw", LS_PROFILE="sv_profile";

  const ls = {
    get:k=>{ try{return localStorage.getItem(k);}catch{return null;} },
    set:(k,v)=>{ try{localStorage.setItem(k,v);}catch{} },
    remove:k=>{ try{localStorage.removeItem(k);}catch{} },
  };
  const parseJSON=(s,d=null)=>{ try{return s?JSON.parse(s):d;}catch{return d;} };
  const isLoggedIn = ()=> ls.get(LS_AUTH)==="loggedIn";
  const getUser    = ()=> parseJSON(ls.get(LS_USER), null);

  const q = (sel,root=document)=>root.querySelector(sel);
  const qa= (sel,root=document)=>Array.from(root.querySelectorAll(sel));

  let lastAppliedKey = ""; // чтобы не перерисовывать одинаковое состояние

  function keyOfState() {
    const auth = isLoggedIn() ? "1" : "0";
    const role = (getUser() && getUser().role) ? String(getUser().role).toLowerCase() : "";
    return auth + "|" + role;
  }

  function updateTopbar() {
    const a = document.getElementById("auth-link") || q(".login-link");
    if (!a) return;
    if (isLoggedIn()) {
      a.textContent = "Выйти";
      a.href = "#logout";
      a.dataset.action = "logout";
      a.classList.add("is-logged");
    } else {
      a.textContent = "Логин";
      a.href = "login/login.html#login";
      a.removeAttribute("data-action");
      a.classList.remove("is-logged");
    }
  }

  function applyMenu() {
    const logged = isLoggedIn();
    const usr = getUser();
    const role = usr && usr.role ? String(usr.role).toLowerCase() : null;

    // показываем/скрываем ровно по data-show (+ data-role), без динамических вставок
    qa("nav.menu li").forEach(li=>{
      const show = li.dataset && li.dataset.show ? li.dataset.show : "all";
      const needRole = li.dataset && li.dataset.role ? String(li.dataset.role).toLowerCase() : null;

      let visible = (show==="all") || (show==="guest" && !logged) || (show==="auth" && logged);
      if (visible && needRole) {
        visible = !!(role && role === needRole);
      }
      li.style.display = visible ? "" : "none";
    });
  }

  function applyUIIfChanged() {
    const key = keyOfState();
    if (key === lastAppliedKey) return; // состояние не изменилось — ничего не делаем
    lastAppliedKey = key;
    updateTopbar();
    applyMenu();
  }

  async function fetchMeAndSync() {
    try {
      const r = await fetch("/api/auth/me", { method:"GET", credentials:"include" });
      if (!r.ok) throw 0;
      const data = await r.json();
      if (data && data.loggedIn) {
        ls.set(LS_AUTH, "loggedIn");
        if (data.user_merged)  ls.set(LS_USER, JSON.stringify(data.user_merged));
        if (data.user_auth)    ls.set(LS_USER_RAW, JSON.stringify(data.user_auth));
        if (typeof data.user_profile!=="undefined") ls.set(LS_PROFILE, JSON.stringify(data.user_profile));
      } else {
        ls.remove(LS_AUTH); ls.remove(LS_USER); ls.remove(LS_USER_RAW); ls.remove(LS_PROFILE);
      }
      applyUIIfChanged();
    } catch { /* offline/сервер молчит — оставляем local */ }
  }

  async function doLogout() {
    try { await fetch("/api/auth/logout", { method:"POST", credentials:"include" }); } catch {}
    ls.remove(LS_AUTH); ls.remove(LS_USER); ls.remove(LS_USER_RAW); ls.remove(LS_PROFILE);
    applyUIIfChanged();
  }

  function bindGlobal() {
    document.addEventListener("click", (e)=>{
      const a = e.target.closest("[data-action='logout']");
      if (a) { e.preventDefault(); doLogout(); }
    }, { passive:false });

    window.addEventListener("storage", (e)=>{
      if ([LS_AUTH,LS_USER,LS_USER_RAW,LS_PROFILE].includes(e.key)) applyUIIfChanged();
    });
  }

  function whenFragmentsReady(cb) {
    if (q("#topbar") && q("nav.menu")) { cb(); return; }
    const obs = new MutationObserver(()=>{
      if (q("#topbar") && q("nav.menu")) { obs.disconnect(); cb(); }
    });
    obs.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(()=>{ try{cb();}catch{} }, 5000); // страховка
  }

  function init() {
    bindGlobal();
    applyUIIfChanged();            // применяем local state мгновенно
    whenFragmentsReady(()=>{       // ещё раз, когда подгрузятся фрагменты
      applyUIIfChanged();
      fetchMeAndSync();            // и только потом идём за /me
    });
  }

  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
