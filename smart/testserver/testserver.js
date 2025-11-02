// Безопасный пинг API: не падает, если бэкенд недоступен
document.addEventListener("DOMContentLoaded", async () => {
const box = document.getElementById("pingBox");
if (!box) return;
try {
const r = await fetch("/api/testserver/ping", {cache: "no-cache"});
if (!r.ok) throw new Error(r.status + " "+ r.statusText);
const data = await r.json();
box.textContent = `Ответ API: ${JSON.stringify(data)}`;
} catch (e) {
box.textContent = "Не удалось связаться с API (это ок для фронт-демо).";
console.warn(e);
}
});