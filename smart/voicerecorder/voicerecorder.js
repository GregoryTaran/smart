// -------------------------------------------------------------
//  SMART VISION — WAV Recorder + WebSocket (local/prod)
// -------------------------------------------------------------

import SVAudioCore from "/voicerecorder/audiocore/sv-audio-core.js";
import WavSegmenter from "/voicerecorder/audiocore/wav-segmenter.js";

// -------------------------
// UI elements
// -------------------------
const statusEl = document.getElementById("status");
const startBtn  = document.getElementById("startBtn");
const pauseBtn  = document.getElementById("pauseBtn");
const stopBtn   = document.getElementById("stopBtn");
const player    = document.getElementById("sv-player");

// -------------------------
// USER
// -------------------------
const USER_ID = localStorage.getItem("sv_user_id");
if (!USER_ID) {
    alert("Нет user_id — авторизуйся заново");
    location.href = "/";
}

// -------------------------
// Global state
// -------------------------
let audioCore = null;
let segmenter = null;
let ws = null;
let rec_id = null;
let recording = false;


// -------------------------------------------------------------
//  AUTO WS URL — локалка (vite) / продакшн (render)
// -------------------------------------------------------------
function getWsUrl() {
    // локальная разработка
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        return "ws://localhost:8000/ws/voicerecorder";
    }

    // продакшен
    return location.origin.replace("http", "ws") + "/ws/voicerecorder";
}

function setStatus(text) {
    statusEl.textContent = text;
}


// -------------------------------------------------------------
//  START RECORDING
// -------------------------------------------------------------
startBtn.onclick = async () => {
    if (recording) return;

    setStatus("Инициализация…");

    // 1) init AudioCore (AudioWorklet)
    audioCore = new SVAudioCore({
        chunkSize: 2048,
        workletUrl: "/voicerecorder/audiocore/recorder.worklet.js"
    });
    await audioCore.init();

    // 2) WAV segmenter
    segmenter = new WavSegmenter({
        sampleRate: audioCore.getContext().sampleRate,
        segmentSeconds: 2,
        normalize: true,
        padLastSegment: true
    });

    // 3) каждую порцию Float32 передаём в сегментер
    audioCore.onAudioFrame = (frameF32) => {
        segmenter.pushFrame(frameF32);
    };

    // 4) WebSocket
    const wsUrl = getWsUrl();
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        rec_id = crypto.randomUUID();

        ws.send(`START ${JSON.stringify({
            user_id: USER_ID,
            rec_id: rec_id,
            ext: ".wav"
        })}`);

        setStatus("Recording…");
    };

    ws.onmessage = (ev) => {
        try {
            const data = JSON.parse(ev.data);
            if (data.status === "SAVED") {
                player.src = data.url;
                player.classList.remove("sv-player--disabled");
                setStatus("Saved ✓");
            }
        } catch {
            console.log("[WS msg]", ev.data);
        }
    };

    ws.onerror = (err) => {
        console.error("[WS ERROR]", err);
        setStatus("WebSocket error");
    };

    recording = true;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
};


// -------------------------------------------------------------
//  PAUSE / RESUME
// -------------------------------------------------------------
pauseBtn.onclick = () => {
    if (!recording || !audioCore) return;

    if (audioCore._paused) {
        audioCore.resumeCapture();
        pauseBtn.textContent = "Pause";
        setStatus("Recording…");
    } else {
        audioCore.pauseCapture();
        pauseBtn.textContent = "Resume";
        setStatus("Paused");
    }
};


// -------------------------------------------------------------
//  STOP RECORDING
// -------------------------------------------------------------
stopBtn.onclick = async () => {
    if (!recording || !audioCore) return;

    setStatus("Processing…");

    audioCore.pauseCapture();

    // создаём последний сегмент, если он висит
    segmenter.stop();

    // отправляем все WAV-сегменты
    const segs = segmenter._segments || [];

    for (let s of segs) {
        if (!s.pcmInt16 || !s.pcmInt16.length) continue;

        const wavBlob = segmenter._makeWavBlob(s.pcmInt16, s.sampleRate);
        const buf = await wavBlob.arrayBuffer();
        ws.send(new Uint8Array(buf));
    }

    ws.send("END");

    // cleanup
    recording = false;
    audioCore.stop();
    audioCore = null;

    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
};
