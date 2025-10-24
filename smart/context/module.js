// ======== Context Module (v1.6 — fixed recorder path for /smart/context/) ========

export async function render(mount) {
  mount.innerHTML = `
    <div style="background:#f2f2f2; border-radius:12px; padding:18px;">
      <h2 style="margin:0 0 12px 0;">🎧 Context v1 — Audio → Server → Whisper → GPT → TTS</h2>
      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">🧑 Голос озвучки:</label>
        <select id="voice-select" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="alloy">Alloy (универсальный)</option>
          <option value="verse">Verse (бархатный мужской)</option>
          <option value="echo">Echo (низкий тембр)</option>
          <option value="breeze">Breeze (лёгкий мужской)</option>
          <option value="coral">Coral (мягкий мужской)</option>
          <option value="astra">Astra (женский)</option>
        </select>
      </div>
      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">Режим захвата:</label>
        <select id="capture-mode" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="raw">🎧 RAW — без обработки</option>
          <option value="agc">🧠 AGC — автоусиление и шумоподавление</option>
          <option value="gain">📢 GAIN — ручное усиление</option>
        </select>
      </div>
      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">Режим обработки:</label>
        <select id="process-mode" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="recognize">🎧 Только распознавание</option>
          <option value="translate">🔤 Перевод через GPT</option>
          <option value="assistant">🤖 Ответ ассистента</option>
        </select>
      </div>
      <div style="text-align:center; margin-bottom:10px;">
        <label style="font-weight:600;">Языковая пара:</label>
        <select id="lang-pair" style="margin-left:8px; padding:6px 10px; border-radius:6px;">
          <option value="en-ru">🇬🇧 EN ↔ 🇷🇺 RU</option>
          <option value="es-ru">🇪🇸 ES ↔ 🇷🇺 RU</option>
          <option value="fr-ru">🇫🇷 FR ↔ 🇷🇺 RU</option>
          <option value="de-ru">🇩🇪 DE ↔ 🇷🇺 RU</option>
        </select>
      </div>
      <div class="controls" style="text-align:center; margin-bottom:10px;">
        <button id="ctx-start" style="padding:10px 20px;border:none;border-radius:8px;background:#4caf50;color:#fff;">Start</button>
        <button id="ctx-stop"  style="padding:10px 20px;border:none;border-radius:8px;background:#f44336;color:#fff;" disabled>Stop</button>
      </div>
      <div id="ctx-log" style="white-space:pre-wrap;background:#fff;padding:10px;border-radius:8px;min-height:300px;border:1px solid #ccc;font-size:14px;overflow:auto;"></div>
    </div>
  `;

  const logEl = mount.querySelector("#ctx-log");
  const btnStart = mount.querySelector("#ctx-start");
  const btnStop  = mount.querySelector("#ctx-stop");
  const modeSel  = mount.querySelector("#capture-mode");
  const procSel  = mount.querySelector("#process-mode");
  const langSel  = mount.querySelector("#lang-pair");
  const voiceSel = mount.querySelector("#voice-select");

  const WS_URL = `${location.origin.replace(/^http/, "ws")}/ws`;
  let ws, audioCtx, worklet, stream;
  let buffer = [], total = 0, lastSend = 0, sampleRate = 44100, sessionId = null;

  function log(msg) {
    const linked = msg.replace(/(https?:\/\/[^\s]+)/g, (url) => `<a href="${url}" target="_blank">${url}</a>`);
    const line = document.createElement("div");
    line.innerHTML = linked;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  btnStart.onclick = async () => {
    try {
      const mode = modeSel.value;
      const processMode = procSel.value;
      const langPair = langSel.value;
      const voice = voiceSel.value;

      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        const msg = String(e.data);
        if (msg.startsWith("SESSION:")) sessionId = msg.split(":")[1];
        log("📩 " + msg);
      };
      ws.onclose = () => log("❌ Disconnected");

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      log("🎛 Detected SampleRate: " + sampleRate + " Hz");

      // ✅ исправленный путь для Render
      await audioCtx.audioWorklet.addModule("smart/context/recorder-worklet.js");

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "meta", sampleRate, mode, processMode, langPair, voice }));
        log("✅ Connected to WebSocket server");
      };
