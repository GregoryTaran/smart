// voicerecorder.js — WebSocket версия под старый UI
console.log("voicerecorder.js loaded");

// =============== USER ID ===============
const USER_ID = localStorage.getItem("sv_user_id");
if (!USER_ID) {
    alert("Нет user_id, авторизуйтесь заново");
    location.href = "/index.html";
}

// =============== ELEMENTS ===============
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn  = document.getElementById("stopBtn");
const player = document.getElementById("sv-player");

let mediaRecorder;
let chunks = [];
let ws = null;


// =============== HELPERS ===============
function setStatus(t) {
    statusEl.textContent = t;
}

function wsConnect(rec_id) {
    return new Promise(resolve => {
        const wsUrl = location.origin.replace("http", "ws") + "/ws/voicerecorder";
        const socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            socket.send(`START ${JSON.stringify({
                user_id: USER_ID,
                rec_id,
                ext: ".webm"
            })}`);
            resolve(socket);
        };

        socket.onmessage = e => {
            try {
                const data = JSON.parse(e.data);
                if (data.status === "SAVED") {
                    player.src = data.url;
                    player.classList.remove("sv-player--disabled");
                    setStatus("Готово ✓");
                }
            } catch {}
        };

        socket.onerror = () => setStatus("WebSocket error");

        return socket;
    });
}


// =============== START ===============
startBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        chunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.start(1000);
        setStatus("recording…");

        startBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled  = false;

    } catch (e) {
        setStatus("microphone: denied");
    }
};


// =============== PAUSE ===============
pauseBtn.onclick = () => {
    if (!mediaRecorder) return;

    if (mediaRecorder.state === "recording") {
        mediaRecorder.pause();
        pauseBtn.textContent = "Resume";
        setStatus("paused");
    } 
    else if (mediaRecorder.state === "paused") {
        mediaRecorder.resume();
        pauseBtn.textContent = "Pause";
        setStatus("recording…");
    }
};


// =============== STOP ===============
stopBtn.onclick = async () => {
    if (!mediaRecorder) return;

    mediaRecorder.stop();
    setStatus("processing…");

    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled  = true;

    const rec_id = crypto.randomUUID();
    ws = await wsConnect(rec_id);

    // отправляем все webm chunk-и
    for (let blob of chunks) {
        const buf = await blob.arrayBuffer();
        ws.send(new Uint8Array(buf));
    }

    ws.send("END");
};
