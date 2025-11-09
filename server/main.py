# server/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse
import logging, os
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("server")

app = FastAPI(title="SMART Backend", version="0.1.0")

# CORS (relaxed for dev; tighten in prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API routes (обновили импорты под плоские папки) ---
try:
    # было: from api_testserver import router as testserver_router
    from core.api_testserver import router as testserver_router
    app.include_router(testserver_router, prefix="/api/testserver", tags=["testserver"])
except Exception as e:
    log.warning(f"API module not loaded: {e}")

try:
    # было: from api_auth import router as auth_router
    from auth.api_auth import router as auth_router
    app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
except Exception as e:
    log.warning(f"Auth module not loaded: {e}")

# --- Voicerecorder WS (подключаем ДО статики)
try:
    # было: from ws_voicerecorder import router as voicerecorder_router
    from voicerecorder.ws_voicerecorder import router as voicerecorder_router
    app.include_router(voicerecorder_router, prefix="", tags=["voicerecorder"])
    log.info("voicerecorder router mounted (registered before static root)")
except Exception as e:
    log.info("voicerecorder router not mounted (module missing or import error): %s", e)

# --- Health endpoints ---
@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

@app.get("/api/info")
def info():
    return JSONResponse({
        "service": "smart-backend",
        "python_version": os.environ.get("PYTHON_VERSION", ""),
        "env": os.environ.get("ENV", "dev"),
    })

# ---------------------------------------------------------------------
# /data — раздаём серверные файлы (mp3/транскрипты и т.п.)
DATA_DIR = Path(os.getcwd()).resolve() / "data"
VOICE_DATA_DIR = DATA_DIR / "voicerecorder"
try:
    VOICE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
    log.info(f"Mounted /data static from: {VOICE_DATA_DIR}")
except Exception as e:
    log.warning("Could not mount data dir as static: %s", e)

# --- Статика фронта (ищем ../Smart или ../smart). Монтируем ПОСЛЕ WS.
CANDIDATES = [
    Path(__file__).resolve().parents[1] / "Smart",
    Path(__file__).resolve().parents[1] / "smart",
]
STATIC_ROOT = next((p.resolve() for p in CANDIDATES if p.exists()), None)

if STATIC_ROOT and STATIC_ROOT.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_ROOT), html=True), name="static")
    log.info(f"Mounted static from: {STATIC_ROOT}")
else:
    log.warning("Static directory not found: expected ../Smart or ../smart")

@app.get("/.static-check", response_class=JSONResponse)
def static_check():
    return {"mounted": bool(STATIC_ROOT and STATIC_ROOT.exists()),
            "static_root": str(STATIC_ROOT) if STATIC_ROOT else None}
