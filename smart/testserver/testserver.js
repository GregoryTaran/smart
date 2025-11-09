// TestServer — E2E проверка: фронт ↔ сервер ↔ база
// Работает на проде (относительные пути) и локально (override API Base)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (id) => document.getElementById(id);
const log = (msg, data) => {
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}` + (data ? `\n${safe(JSON.stringify(data, null, 2))}` : "");
  $("logOut").textContent = line + "\n\n" + $("logOut").textContent;
};
const safe = (s) => s;

let supabase = null;
let token = null;

function apiBase() {
  const override = $("apiBase").value.trim();
  if (override) return override.replace(/\/$/, "");
  // по умолчанию — тот же домен (прод)
  return location.origin.replace(/\/$/, "");
}

function setState() {
  $("stateApi").textContent = apiBase();
  $("stateUrl").textContent = $("sbUrl").value ? "ok" : "—";
  $("stateAnon").textContent = $("sbAnon").value ? "ok" : "—";
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

/** 0) PING */
$("btnPing").onclick = async () => {
  try {
    const data = await fetchJSON(`${apiBase()}/api/testserver/ping`, { cache: "no-cache" });
    $("pingOut").textContent = JSON.stringify(data, null, 2);
    log("PING ok", data);
  } catch (e) {
    $("pingOut").textContent = String(e.message || e);
    log("PING error", { error: e.message || String(e) });
  }
};

/** 1) INIT */
$("btnInit").onclick = () => {
  const url = $("sbUrl").value.trim();
  const anon = $("sbAnon").value.trim();
  if (!url || !anon) {
    log("Укажи Supabase URL и ANON KEY");
    return;
  }
  supabase = createClient(url, anon);
  setState();
  log("Supabase клиент инициализирован");
};

$("btnClear").onclick = () => {
  ["apiBase", "sbUrl", "sbAnon", "email", "password"].forEach(id => $(id).value = "");
  ["pingOut", "authOut", "listOut", "tokenOut", "logOut"].forEach(id => $(id).textContent = "");
  $("stateUser").textContent = "—";
  $("stateHasSession").textContent = "нет";
  supabase = null; token = null;
  setState();
  log("Форма очищена");
};

setState();

/** 2) AUTH */
async function refreshSession() {
  if (!supabase) { log("Сначала инициализируй Supabase (кнопка 'Инициализировать')"); return null; }
  const { data: { session } } = await supabase.auth.getSession();
  token = session?.access_token || null;
  $("stateHasSession").textContent = token ? "да" : "нет";
  $("stateUser").textContent = session?.user?.email || session?.user?.id || "—";
  $("tokenOut").textContent = token ? token : "—";
  return session;
}

$("btnSignUp").onclick = async () => {
  try {
    if (!supabase) { log("Инициализируй Supabase", null); return; }
    const { data, error } = await supabase.auth.signUp({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error) throw error;
    log("SignUp ok", data);
    await refreshSession();
  } catch (e) { log("SignUp error", { message: e.message }); }
};

$("btnSignIn").onclick = async () => {
  try {
    if (!supabase) { log("Инициализируй Supabase", null); return; }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error) throw error;
    log("SignIn ok", { user: data.user?.id || data.user?.email || "ok" });
    await refreshSession();
  } catch (e) { log("SignIn error", { message: e.message }); }
};

$("btnGuest").onclick = async () => {
  try {
    if (!supabase) { log("Инициализируй Supabase", null); return; }
    const rnd = crypto.randomUUID();
    const { data, error } = await supabase.auth.signUp({
      email: `${rnd}@guest.local`,
      password: crypto.randomUUID()
    });
    if (error) throw error;
    log("Guest created", data.user);
    await refreshSession();
  } catch (e) { log("Guest error", { message: e.message }); }
};

$("btnSignOut").onclick = async () => {
  try {
    if (!supabase) return;
    await supabase.auth.signOut();
    await refreshSession();
    log("Signed out");
  } catch (e) { log("SignOut error", { message: e.message }); }
};

$("btnGetSession").onclick = async () => {
  try { await refreshSession(); log("Session fetched"); }
  catch (e) { log("GetSession error", { message: e.message }); }
};

/** 3) SERVER: whoami / profiles */
$("btnWhoAmI").onclick = () => callApi("/api/db/whoami", true, $("authOut"));
$("btnProfileMe").onclick = () => callApi("/api/db/profiles/me", true, $("authOut"));

/** 4) SERVER: records list/create */
$("btnList").onclick = () => callApi("/api/db/records", true, $("listOut"));
// СТАЛО: автоподстановка record_id после успешного POST
const recordIdInput = document.getElementById("recordId");
$("btnCreate").onclick = async () => {
  const out = document.getElementById("listOut");
  try {
    const base = apiBase();
    const headers = { "Content-Type": "application/json" };

    // токен нужен для records
    await refreshSession();
    if (!token) throw new Error("Нет токена (войдите и нажмите «Получить сессию»)");
    headers.Authorization = `Bearer ${token}`;

    const body = { title: "Hello from TestServer", meta: { source: "testserver" } };

    // POST /api/db/records — создаём и получаем 1 объект
    const created = await fetchJSON(`${base}/api/db/records`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    out.textContent = "Создано:\n" + JSON.stringify(created, null, 2);
    log("/api/db/records POST ok", created);

    // авто-подставим id в поле и сразу покажем GET {id}
    if (created && created.id && recordIdInput) {
      recordIdInput.value = created.id;
      const oneOut = document.getElementById("oneOut");
      const obj = await fetchJSON(`${base}/api/db/records/${created.id}`, { headers });
      if (oneOut) oneOut.textContent = JSON.stringify(obj, null, 2);
      log(`/api/db/records/${created.id} GET ok`, obj);
    }

    // по желанию — обновим список
    try {
      const list = await fetchJSON(`${base}/api/db/records`, { headers });
      out.textContent = JSON.stringify(list, null, 2);
      log("/api/db/records GET ok", list);
    } catch (_) {}
  } catch (e) {
    out.textContent = `Ошибка POST /records: ${e.message || e}`;
    log("/api/db/records POST error", { error: e.message || String(e) });
  }
};


async function callApi(path, needsToken, outEl, opts = {}) {
  try {
    const base = apiBase();
    const headers = Object.assign({ }, opts.headers || {});
    if (needsToken) {
      const s = await refreshSession();
      if (!token) throw new Error("Нет токена (в dev можно включить DEV_BYPASS_AUTH на бэке)");
      headers["Authorization"] = `Bearer ${token}`;
    }
    const data = await fetchJSON(`${base}${path}`, Object.assign({}, opts, { headers }));
    outEl.textContent = JSON.stringify(data, null, 2);
    log(`${path} ok`, data);
  } catch (e) {
    outEl.textContent = String(e.message || e);
    log(`${path} error`, { error: e.message || String(e) });
  }
}


// --- one/get & delete by id ---
const $id = document.getElementById("recordId");
const $oneOut = document.getElementById("oneOut");

document.getElementById("btnGetOne").onclick = () => {
  const id = ($id.value || "").trim();
  if (!id) { $oneOut.textContent = "Укажи record_id"; return; }
  callApi(`/api/db/records/${id}`, true, $oneOut);
};

document.getElementById("btnDelete").onclick = () => {
  const id = ($id.value || "").trim();
  if (!id) { $oneOut.textContent = "Укажи record_id"; return; }
  callApi(`/api/db/records/${id}`, true, $oneOut, { method: "DELETE" });
};
