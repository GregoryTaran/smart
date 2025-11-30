// voicerecorder.js — WebSocket версия под старый UI + MIC-INDICATOR
console.log("[VR] voicerecorder.js loaded");

// -------------------------
// MIC INDICATOR (импорт)
// -------------------------
import MicIndicator from "/voicerecorder/mic-indicator/mic-indicator.js";

// -------------------------
// USER SESSION
// -------------------------
const USER_ID = localStorage.getItem("sv_user_id");
if (!USER_ID) {
    alert("Ошибка: нет user_id. Авторизуйтесь заново.");
    location.href = "/index.html";
}

// -------------------------
// ELEMENTS
// -------------------------
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn  = document.getElementById("stopBtn");
const player = document.getElementById("sv-player");
const micContainer = document.getElementById("vc-level");

let mediaRecorder = null;
let chunks = [];
let ws = null;
let rec_id = null;
let micIndicator = null;


// -------------------------
// HELPERS
// -------------------------
function setStatus(text) {
    statusEl.textContent = text;
}


// -------------------------
// START BUTTON
// -------------------------
startBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // --- MIC INDICATOR ---
        if (!micIndicator) {
            micIndicator = new MicIndicator(micContainer, {
                analyserSmoothing: 0.25,
                fftSize: 1024,
                stepMs: 100,
            });
        }
        await micIndicator.connectStream(stream);

        // --- Recorder ---
        chunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = ev => {
            if (ev.data.size > 0) chunks.push(ev.data);
        };

        mediaRecorder.start(1000);

        rec_id = crypto.randomUUID();
        setStatus("Recording…");

        startBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;

    } catch (e) {
        console.error(e);
        setStatus("microphone: denied");
    }
};


// -------------------------
// PAUSE BUTTON
// -------------------------
pauseBtn.onclick = () => {
    if (!mediaRecorder) return;

    if (mediaRecorder.state === "recording") {
        mediaRecorder.pause();
        pauseBtn.textContent = "Resume";
        setStatus("Paused");
        if (micIndicator) micIndicator.freeze();
    } else if (mediaRecorder.state === "paused") {
        mediaRecorder.resume();
        pauseBtn.textContent = "Pause";
        setStatus("Recording…");
        if (micIndicator) micIndicator.unfreeze();
    }
};


// -------------------------
// STOP BUTTON
// -------------------------
stopBtn.onclick = async () => {
    if (!mediaRecorder) return;

    mediaRecorder.stop();
    setStatus("Processing…");

    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;

    // --- MIC INDICATOR STOP ---
    if (micIndicator) {
        micIndicator.freeze(); // зафиксировать последний кадр
    }

    // --- WebSocket CONNECT ---
    const wsUrl = location.origin.replace("http", "ws") + "/ws/voicerecorder";
    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
        ws.send(`START ${JSON.stringify({
            user_id: USER_ID,
            rec_id: rec_id,
            ext: ".webm"
        })}`);

        for (let blob of chunks) {
            const buf = await blob.arrayBuffer();
            ws.send(new Uint8Array(buf));
        }

        ws.send("END");
    };

    ws.onmessage = e => {
        try {
            const data = JSON.parse(e.data);
            if (data.status === "SAVED") {
                player.src = data.url;
                player.classList.remove("sv-player--disabled");
                setStatus("Saved ✓");
            }
        } catch {
            console.log("WS:", e.data);
        }
    };
};
