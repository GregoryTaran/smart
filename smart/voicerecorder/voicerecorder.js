// -------------------------------------------------------------
// SMART VISION — WAV Recorder + WebSocket
// -------------------------------------------------------------

import SVAudioCore from "/voicerecorder/audiocore/sv-audio-core.js";
import WavSegmenter from "/voicerecorder/audiocore/wav-segmenter.js";
import MicIndicator from "/voicerecorder/mic-indicator/mic-indicator.js";

// UI
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn  = document.getElementById("stopBtn");
const player   = document.getElementById("sv-player");

// MIC INDICATOR
const indicator = new MicIndicator(document.getElementById("vc-level"));

// USER
const USER_ID = localStorage.getItem("sv_user_id");
if (!USER_ID) {
    alert("Нет user_id — авторизуйся заново");
    location.href = "/";
}

// GLOBAL STATE
let audioCore = null;
let segmenter = null;
let ws = null;
let rec_id = null;
let recording = false;
let segments = [];

// WS URL
function getWsUrl() {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        return "ws://localhost:8000/ws/voicerecorder";
    }
    return location.origin.replace("http", "ws") + "/ws/voicerecorder";
}

function setStatus(text) {
    statusEl.textContent = text;
}

// -------------------------------------------------------------
// START
// -------------------------------------------------------------
startBtn.onclick = async () => {
    if (recording) return;

    setStatus("Инициализация…");

    audioCore = new SVAudioCore({
        chunkSize: 2048,
        workletUrl: "/voicerecorder/audiocore/recorder.worklet.js",
    });
    await audioCore.init();

    indicator.connectStream(audioCore.getStream());

    segmenter = new WavSegmenter({
        sampleRate: audioCore.getContext().sampleRate,
        segmentSeconds: 2,
        normalize: true,
        padLastSegment: true,
        emitBlobPerSegment: false,
    });

    segments = [];
    segmenter.onSegment = (seg) => segments.push(seg);

    audioCore.onAudioFrame = (frame) => segmenter.pushFrame(frame);

    const wsUrl = getWsUrl();
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        rec_id = crypto.randomUUID();

        ws.send(
            "START " +
            JSON.stringify({
                user_id: USER_ID,
                rec_id,
                ext: ".wav",
            })
        );

        setStatus("Recording…");
    };

    ws.onmessage = (ev) => {
        try {
            const data = JSON.parse(ev.data);
            if (data.status === "SAVED") {
                player.src = data.url;
                player.classList.remove("sv-player--disabled");
                setStatus("Saved ✓");

                // AUTO reload history
                loadHistory();
            }
        } catch {}
    };

    ws.onerror = () => setStatus("WebSocket error");
    ws.onclose = () => console.log("[WS CLOSED]");

    recording = true;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
};

// -------------------------------------------------------------
// PAUSE / RESUME
// -------------------------------------------------------------
pauseBtn.onclick = () => {
    if (!recording || !audioCore) return;

    if (audioCore._paused) {
        audioCore.resumeCapture();
        indicator.unfreeze();
        pauseBtn.textContent = "Pause";
        setStatus("Recording…");
    } else {
        audioCore.pauseCapture();
        indicator.freeze();
        pauseBtn.textContent = "Resume";
        setStatus("Paused");
    }
};

// -------------------------------------------------------------
// STOP
// -------------------------------------------------------------
stopBtn.onclick = async () => {
    if (!recording || !audioCore) return;

    setStatus("Processing…");

    audioCore.pauseCapture();
    segmenter.stop();

    const toSend = segments.slice();
    segments = [];

    for (const seg of toSend) {
        const wavBlob = segmenter._makeWavBlob(seg.pcmInt16, seg.sampleRate, 1);
        const buf = await wavBlob.arrayBuffer();
        ws.send(new Uint8Array(buf));
    }

    ws.send("END");

    recording = false;
    audioCore.stop();
    indicator.baselineOnly();
    audioCore = null;

    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
};

// -------------------------------------------------------------
// HISTORY
// -------------------------------------------------------------

async function loadHistory() {
    const res = await fetch(`/api/voicerecorder/list?user_id=${USER_ID}`);
    const json = await res.json();
    if (json.ok) renderHistory(json.records);
}

function renderHistory(records) {
    const box = document.getElementById("vc-history");
    box.innerHTML = "";

    if (!records.length) {
        box.innerHTML = "<p style='color:#777;text-align:center;'>Пока нет записей</p>";
        return;
    }

    for (const rec of records) {
        const card = document.createElement("div");
        card.className = "vc-entry-card";

        const date = new Date(rec.created_at).toLocaleString("ru-RU");
        const name = rec.display_name || rec.file_name;

        card.innerHTML = `
            <h3 class="vc-entry-title">${name}</h3>
            <div class="vc-entry-meta">${date} · ${rec.duration_seconds}s</div>

            <audio controls src="${rec.file_url}" style="width:100%;"></audio>

            <div class="vc-entry-actions">
                <button data-edit="${rec.rec_id}">✏️ Переименовать</button>
                <button data-del="${rec.rec_id}">🗑 Удалить</button>
            </div>
        `;

        box.appendChild(card);
    }

    bindHistoryActions();
}

function bindHistoryActions() {
    document.querySelectorAll("[data-edit]").forEach(btn =>
        btn.onclick = () => openRenameModal(btn.dataset.edit)
    );

    document.querySelectorAll("[data-del]").forEach(btn =>
        btn.onclick = () => openDeleteModal(btn.dataset.del)
    );
}

function openRenameModal(rec_id) {
    const newName = prompt("Введите новое название записи:");
    if (!newName) return;

    fetch("/api/voicerecorder/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, rec_id, display_name: newName })
    }).then(() => loadHistory());
}

function openDeleteModal(rec_id) {
    if (!confirm("Удалить запись полностью?")) return;

    fetch("/api/voicerecorder/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, rec_id })
    }).then(() => loadHistory());
}

loadHistory();
