import React from "react";

/**
 * FooterGeolocation.jsx
 *
 * Задача:
 *  - В футере сайта запрашивать геолокацию у пользователя по клику (один раз),
 *  - Если разрешено — автоматически подписываться на обновления (watchPosition),
 *  - Красиво отображать координаты, точность и время последнего обновления,
 *  - Ничего никуда не отправлять — чистый клиент.
 *
 * Замечания:
 *  - Работает только на HTTPS или на http://localhost.
 *  - Если Permissions API доступен и состояние "granted" — начинаем слежение без запроса.
 *  - Сохраняем последние координаты в localStorage, чтобы показать сразу при перезагрузке.
 */

const STORAGE_KEY = "footer_geo:lastPosition";

function loadSavedPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.latitude === "number" &&
      typeof parsed.longitude === "number"
    ) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

function savePosition(pos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch (_) {}
}

function formatAccuracy(meters) {
  if (meters == null) return "–";
  if (meters < 1000) return `±${Math.round(meters)} м`;
  const km = meters / 1000;
  return `±${km.toFixed(km >= 10 ? 0 : 1)} км`;
}

function timeAgo(ts) {
  if (!ts) return "–";
  const d = typeof ts === "number" ? new Date(ts) : ts;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} дн назад`;
}

export default function FooterGeolocation() {
  const [supported, setSupported] = React.useState(false);
  const [state, setState] = React.useState(/** @type {"idle"|"prompt"|"granted"|"denied"|"tracking"|"error"} */("idle"));
  const [coords, setCoords] = React.useState(() => loadSavedPosition());
  const [errMsg, setErrMsg] = React.useState("");
  const watchIdRef = React.useRef(/** @type {number|null} */(null));

  const startWatch = React.useCallback(() => {
    if (!("geolocation" in navigator)) return;
    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 };
    try {
      const id = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position.coords;
          const payload = {
            latitude,
            longitude,
            accuracy,
            altitude: altitude ?? null,
            altitudeAccuracy: altitudeAccuracy ?? null,
            heading: heading ?? null,
            speed: speed ?? null,
            timestamp: position.timestamp,
          };
          setCoords(payload);
          savePosition(payload);
          setState("tracking");
          setErrMsg("");
        },
        (err) => {
          setErrMsg(err.message || "Не удалось получить координаты");
          setState(err.code === 1 ? "denied" : "error");
        },
        opts
      );
      watchIdRef.current = id;
    } catch (e) {
      setErrMsg(String(e));
      setState("error");
    }
  }, []);

  const stopWatch = React.useCallback(() => {
    if (watchIdRef.current != null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState("granted");
  }, []);

  const requestOnce = React.useCallback(() => {
    if (!("geolocation" in navigator)) return;
    setState("prompt");
    const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position.coords;
        const payload = {
          latitude,
          longitude,
          accuracy,
          altitude: altitude ?? null,
          altitudeAccuracy: altitudeAccuracy ?? null,
          heading: heading ?? null,
          speed: speed ?? null,
          timestamp: position.timestamp,
        };
        setCoords(payload);
        savePosition(payload);
        setState("granted");
        setErrMsg("");
        // Автостарт подписки после первого успешного получения
        startWatch();
      },
      (err) => {
        setErrMsg(err.message || "Не удалось получить координаты");
        setState(err.code === 1 ? "denied" : "error");
      },
      opts
    );
  }, [startWatch]);

  // Инициализация
  React.useEffect(() => {
    const hasGeo = "geolocation" in navigator;
    setSupported(hasGeo);
    if (!hasGeo) return;

    // Если Permissions API доступен — узнаём состояние заранее
    (async () => {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const perm = await navigator.permissions.query({ name: "geolocation" });
          if (perm.state === "granted") {
            setState("granted");
            startWatch();
          } else if (perm.state === "denied") {
            setState("denied");
          } else {
            setState("idle");
          }
          // Реакция на смену статуса (например, в настройках браузера)
          perm.onchange = () => {
            if (perm.state === "granted") startWatch();
            if (perm.state === "denied") stopWatch();
            setState(perm.state === "granted" ? "granted" : perm.state === "denied" ? "denied" : "idle");
          };
        } else {
          // Нет Permissions API — показываем кнопку запроса
          setState(coords ? "granted" : "idle");
        }
      } catch (_) {
        setState(coords ? "granted" : "idle");
      }
    })();

    return () => stopWatch();
  }, [startWatch, stopWatch]);

  const badge = (() => {
    switch (state) {
      case "tracking":
        return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">● Отслеживается</span>;
      case "granted":
        return <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">✓ Разрешено</span>;
      case "prompt":
        return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">… Запрос</span>;
      case "denied":
        return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">⨯ Запрещено</span>;
      case "error":
        return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">⚠ Ошибка</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Готово</span>;
    }
  })();

  const canStart = supported && (state === "idle" || state === "denied" || state === "granted");
  const canStop = state === "tracking";

  const lat = coords?.latitude?.toFixed(6);
  const lon = coords?.longitude?.toFixed(6);
  const acc = formatAccuracy(coords?.accuracy);
  const updated = coords?.timestamp ? timeAgo(coords.timestamp) : "–";
  const gmapsUrl = lat && lon ? `https://maps.google.com/?q=${lat},${lon}` : null;
  const osmUrl = lat && lon ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` : null;

  return (
    <footer className="w-full border-t border-slate-200 bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/50">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-100 p-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-slate-600">
              <path d="M12 2a10 10 0 00-10 10 1 1 0 102 0 8 8 0 118 8 1 1 0 100 2 10 10 0 000-20z"/>
              <path d="M12 6a6 6 0 00-6 6 1 1 0 102 0 4 4 0 114 4 1 1 0 100 2 6 6 0 000-12z"/>
              <circle cx="12" cy="12" r="1.5"/>
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              Геолокация
              {badge}
            </div>
            <div className="text-xs text-slate-600">
              {supported ? (
                coords ? (
                  <>
                    <span className="font-semibold">{lat}</span>, <span className="font-semibold">{lon}</span>
                    <span className="mx-1 text-slate-400">•</span>
                    точность {acc}
                    <span className="mx-1 text-slate-400">•</span>
                    обновлено {updated}
                    {gmapsUrl && (
                      <>
                        <span className="mx-1 text-slate-400">•</span>
                        <a href={gmapsUrl} target="_blank" rel="noreferrer" className="underline hover:no-underline">Google Maps</a>
                        <span className="mx-1 text-slate-400">/</span>
                        <a href={osmUrl!} target="_blank" rel="noreferrer" className="underline hover:no-underline">OSM</a>
                      </>
                    )}
                  </>
                ) : (
                  <span>Координаты ещё не получены</span>
                )
              ) : (
                <span>Браузер не поддерживает Geolocation API</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canStart && (
            <button
              type="button"
              onClick={state === "granted" ? startWatch : requestOnce}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {state === "granted" ? "Включить трекинг" : "Определить местоположение"}
            </button>
          )}
          {canStop && (
            <button
              type="button"
              onClick={stopWatch}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 shadow-sm hover:bg-rose-100"
            >
              Остановить
            </button>
          )}
        </div>
      </div>

      {(state === "denied" || state === "error") && (
        <div className="mx-auto max-w-7xl px-4 pb-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {state === "denied" ? (
              <>
                Доступ к геолокации запрещён. Разрешите его в настройках браузера/сайта и попробуйте снова.
              </>
            ) : (
              <>
                Ошибка: {errMsg}
              </>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 pb-4">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Совет: геолокация доступна только на HTTPS (или на http://localhost для разработки). Ничего никуда не отправляется —
          данные остаются в браузере. Для экономии батареи можно отключить трекинг.
        </p>
      </div>
    </footer>
  );
}
