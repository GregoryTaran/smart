from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse
import logging, os
from pathlib import Path

# ------------------------ DB INIT ------------------------
from db import init_db


# ------------------------ ROUTERS ------------------------
# ❗️ ТУТ АККУРАТНАЯ ПРАВКА — подключаем НОВЫЙ vision_server.py
from vision.vision_server import router as vision_router
from voicerecorder.voicerecorder_server import router as vr_router

import auth.smart_auth as smart_auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("server")

app = FastAPI(title="SMART Backend", version="0.2.0")

# ------------------------ STARTUP ------------------------
@app.on_event("startup")
async def startup():
    await init_db()

# ------------------------ MIDDLEWARE ------------------------
app.add_middleware(GZipMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://test.smartvision.life",
        "http://localhost:8000",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------ API ROUTES ------------------------

# ⭐ Vision API — НОВЫЙ vision_server.py
app.include_router(vision_router, prefix="/api")

# ⭐ SMART AUTH
app.include_router(smart_auth.router, prefix="/api/auth", tags=["auth"])

# WebSocket dictation
try:
    from voicerecorder.ws_voicerecorder import router as voicerecorder_ws_router
    app.include_router(voicerecorder_ws_router, prefix="", tags=["voicerecorder-ws"])
    log.info("voicerecorder WS router mounted")
except Exception as e:
    log.info("voicerecorder WS not mounted: %s", e)

# HTTP API dictation — НОВЫЙ voicerecorder_server.py
try:
    from voicerecorder.voicerecorder_server import router as vr_router
    app.include_router(vr_router, prefix="/api/voicerecorder", tags=["voicerecorder"])
    log.info("voicerecorder_server mounted at /api/voicerecorder")
except Exception as e:
    log.warning(f"voicerecorder_server not mounted: {e}")


# Database routers
try:
    from database.api_db import router as db_router
    app.include_router(db_router, prefix="/api/db", tags=["db"])
except Exception as e:
    log.warning(f"DB API not loaded: {e}")

try:
    from database.api_records import router as records_router
    app.include_router(records_router, prefix="/api/db", tags=["records"])
except Exception as e:
    log.warning(f"Records API not loaded: {e}")

# ------------------------ HEALTH ------------------------
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

# ------------------------ STATIC DATA ------------------------
DATA_DIR = Path(os.getcwd()).resolve() / "data"
VOICE_DATA_DIR = DATA_DIR / "voicerecorder"

try:
    VOICE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
    log.info(f"Mounted /data static from: {VOICE_DATA_DIR}")
except Exception as e:
    log.warning("Could not mount data dir as static: %s", e)

# ------------------------ FRONTEND STATIC ------------------------
STATIC_ROOT = (Path(__file__).resolve().parents[1] / "smart").resolve()

if STATIC_ROOT.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_ROOT), html=True), name="frontend")
    log.info(f"[static] Mounted / from: {STATIC_ROOT}")
else:
    log.warning(f"[static] Front root not found: {STATIC_ROOT}")

# ------------------------ DEBUG ------------------------
@app.get("/api/debug/routes")
def _routes():
    return sorted([getattr(r, "path", str(r)) for r in app.routes])
