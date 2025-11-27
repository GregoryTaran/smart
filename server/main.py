from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse
import logging, os
from pathlib import Path

# ------------------------ ROUTERS ------------------------
from vision.router import router as vision_router

# ❗ Новый правильный SVID — импорт ТОЛЬКО router
from svid.svid import router as svid_router

# ❗ AUTH из отдельного модуля (не из SVID!)
from auth.api_auth import router as auth_router, auth_middleware

# ------------------------ LOGGING ------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("server")

app = FastAPI(title="SMART Backend", version="0.1.0")

# ------------------------ MIDDLEWARE ------------------------
app.add_middleware(GZipMiddleware)

# ❗ Правильный auth_middleware — из auth.api_auth (НЕ из SVID)
app.middleware("http")(auth_middleware)

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

# 🎯 Vision API
app.include_router(vision_router, prefix="/api")

# 🎯 AUTH (email/password)
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# 🎯 SVID (visitor/session/identify)
# ❗ НЕ под /api/auth! Новый SVID сам имеет prefix="/api/svid"
app.include_router(svid_router)

# ------------------------ OPTIONAL ROUTERS ------------------------
try:
    from core.api_testserver import router as testserver_router
    app.include_router(testserver_router, prefix="/api/testserver", tags=["testserver"])
except Exception as e:
    log.warning(f"API module not loaded: {e}")

# WebSocket диктофона
try:
    from voicerecorder.ws_voicerecorder import router as voicerecorder_ws_router
    app.include_router(voicerecorder_ws_router, prefix="", tags=["voicerecorder-ws"])
    log.info("voicerecorder WS router mounted")
except Exception as e:
    log.info("voicerecorder WS not mounted: %s", e)

# HTTP диктофон API
try:
    from voicerecorder.voicerecorder_api import router as vr_upload_router
    app.include_router(vr_upload_router)
    log.info("voicerecorder_api router mounted (/api/voicerecorder/*)")
except Exception as e:
    log.warning(f"voicerecorder_api not mounted: {e}")

# Саб-приложение диктофона (не трогаем, всё ок)
try:
    if os.getenv("VR_USE_SUBAPP") == "1":
        from voicerecorder.voicerecorder import app as voicerecorder_app
        app.mount("/api", voicerecorder_app)
        log.info("Voicerecorder sub-app mounted at /api (VR_USE_SUBAPP=1)")
    else:
        log.info("Voicerecorder sub-app NOT mounted (VR_USE_SUBAPP!=1)")
except Exception as e:
    log.warning(f"Voicerecorder sub-app mount skipped: {e}")

# DB routers
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

# Visitor (оставляем)
try:
    from identity.visitor import router as visitor_router
    app.include_router(visitor_router)
    log.info("identity.visitor mounted")
except Exception as e:
    log.warning(f"Identity VISITOR not mounted: {e}")

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
SMART_FRONT_ROOT = os.environ.get("SMART_FRONT_ROOT", "").strip()
MOUNT_PATH = os.environ.get("SMART_MOUNT_PATH", "/").strip() or "/"
cwd_root = (Path(os.getcwd()).resolve() / "smart")
fallback1 = (Path(__file__).resolve().parents[1] / "smart")
fallback2 = (Path(__file__).resolve().parents[1] / "Smart")
candidates = [
    Path(SMART_FRONT_ROOT) if SMART_FRONT_ROOT else None,
    cwd_root,
    fallback1,
    fallback2,
]
STATIC_ROOT = next((p.resolve() for p in candidates if p and p.exists()), None)

if STATIC_ROOT and STATIC_ROOT.exists():
    app.mount(MOUNT_PATH, StaticFiles(directory=str(STATIC_ROOT), html=True), name="frontend")
    log.info(f"[static] Mounted {MOUNT_PATH} from: {STATIC_ROOT}")
else:
    tried = [str(p) for p in candidates if p]
    log.warning("[static] Front root not found. Tried: %s", tried)

# ------------------------ DEBUG ------------------------
@app.get("/api/debug/routes")
def _routes():
    return sorted([getattr(r, "path", str(r)) for r in app.routes])
