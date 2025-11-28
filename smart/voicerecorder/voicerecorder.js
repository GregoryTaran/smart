// voicerecorder.js — новая версия под AUTH v3 + visitor-only SVID

// -------------------------------------------------------------
// API HELPERS
// -------------------------------------------------------------
async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("GET " + url + " " + res.status);
  return await res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error("POST " + url + " " + res.status);
  return await res.json();
}

// -------------------------------------------------------------
// УНИВЕРСАЛЬНЫЙ ИДЕНТИФИКАТОР
// userId для авторизованных
// visitor_id для гостей
// -------------------------------------------------------------
async function ensureUniversalId() {
  // ждём AUTH
  if (window.SV_AUTH?.ready) {
    try { await window.SV_AUTH.ready; } catch {}
  }

  // ждём SVID
  if (window.SVID?.ready) {
    try { await window.SVID.ready; } catch {}
  }

  // 1) если юзер авторизован → возвращаем userId
  if (window.SV_AUTH?.isAuthenticated && window.SV_AUTH?.userId) {
    return {
      id: window.SV_AUTH.userId,
      type: "user"
    };
  }

  // 2) иначе → visitor_id
  const st = window.SVID?.getState?.() || {};
  if (st.visitor_id) {
    return {
      id: st.visitor_id,
      type: "visitor"
    };
  }

  throw new Error("NO_VALID_ID");
}

// -------------------------------------------------------------
// РАБОТА С ЗАПИСЯМИ
// -------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  setupRecorder();
});

function setupRecorder() {
  const recordBtn = document.getElementById("recordBtn");
  const stopBtn = document.getElementById("stopBtn");
  const listBox = document.getElementById("recordsList");

  let mediaRecorder;
  let chunks = [];

  // --- НАЧАТЬ ЗАПИСЬ ---
  recordBtn.onclick = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => chunks.push(e.data);

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const file = new File([blob], "record.webm", { type: "audio/webm" });

      const id = await ensureUniversalId();

      const form = new FormData();
      form.append("file", file);
      form.append("owner_id", id.id);        // userId или visitor_id
      form.append("owner_type", id.type);    // user | visitor

      const r = await fetch("/api/record/upload", {
        method: "POST",
        credentials: "include",
        body: form
      });

      if (!r.ok) {
        alert("Ошибка загрузки записи");
        return;
      }

      loadRecords();
    };

    mediaRecorder.start();
    recordBtn.disabled = true;
    stopBtn.disabled = false;
  };

  // --- ОСТАНОВИТЬ ЗАПИСЬ ---
  stopBtn.onclick = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      recordBtn.disabled = false;
      stopBtn.disabled = true;
    }
  };

  // --- ЗАГРУЗИТЬ СПИСОК ---
  function loadRecords() {
    apiGet("/api/record/list")
      .then(data => {
        listBox.innerHTML = "";
        (data.records || []).forEach(r => {
          const el = document.createElement("div");
          el.className = "record-item";
          el.innerHTML = `
            <audio controls src="${r.url}"></audio>
            <div class="record-date">${new Date(r.created_at).toLocaleString()}</div>
          `;
          listBox.appendChild(el);
        });
      })
      .catch(() => {
        listBox.innerHTML = `<p>Не удалось загрузить записи</p>`;
      });
  }

  loadRecords();
}
