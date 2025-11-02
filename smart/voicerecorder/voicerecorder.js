// Простое демо записи (если браузер поддерживает)
let mediaRecorder, chunks = [];
const $ = (s) => document.querySelector(s);


document.addEventListener("DOMContentLoaded", () => {
const recBtn = $("#btnRec");
const stopBtn = $("#btnStop");
const player = $("#player");


if (!navigator.mediaDevices || !window.MediaRecorder) {
recBtn.disabled = true; stopBtn.disabled = true;
$(".tip").textContent = "Браузер не поддерживает MediaRecorder.";
return;
}


recBtn.addEventListener("click", async () => {
try {
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
mediaRecorder = new MediaRecorder(stream);
chunks = [];
mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
mediaRecorder.onstop = () => {
const blob = new Blob(chunks, { type: "audio/webm" });
player.src = URL.createObjectURL(blob);
};
mediaRecorder.start();
recBtn.disabled = true; stopBtn.disabled = false;
} catch (e) {
console.error(e);
}
});


stopBtn.addEventListener("click", () => {
if (mediaRecorder && mediaRecorder.state !== "inactive") {
mediaRecorder.stop();
recBtn.disabled = false; stopBtn.disabled = true;
}
});
});