from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse
import logging, os
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("server")

app = FastAPI(title="SMART Backend", version="0.1.0")

# ------------------------ CORS (как было) ------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------ API/WS (как было) ----------------------
try:
    from core.api_testserver import router as testserver_router
    app.include_router(testserver_router, prefix="/api/testserver", tags=["testserver"])
except Exception as e:
    log.warning(f"API module not loaded: {e}")

try:
    from auth.api_auth import router as auth_router
    app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
except Exception as e:
    log.warning(f"Auth module not loaded: {e}")

try:
    from voicerecorder.voicerecorder_api import router as vr_upload_router
    app.include_router(vr_upload_router)  # даёт /api/voicerecorder/*
    log.info("voicerecorder_api router mounted")
except Exception as e:
    log.warning(f"voicerecorder_api not mounted: {e}")

try:
    from voicerecorder.ws_voicerecorder import router as voicerecorder_router
    app.include_router(voicerecorder_router, prefix="", tags=["voicerecorder"])
    log.info("voicerecorder router mounted (registered before static root)")
except Exception as e:
    log.info("voicerecorder router not mounted (module missing or import error): %s", e)



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

try:
    from database.api_testserver import router as testserver_router2
    app.include_router(testserver_router2, prefix="/api/testserver", tags=["testserver"])
except Exception as e:
    log.warning(f"TestServer API not loaded: {e}")

try:
    from identity.visitor import router as visitor_router
    app.include_router(visitor_router)
    log.info("identity.visitor mounted")
except Exception as e:
    log.warning(f"Identity VISITOR not mounted: {e}")

try:
    from svid.svid import router as svid_router
    app.include_router(svid_router)
    log.info("svid.svid mounted")
except Exception as e:
    log.error(f"Failed to mount svid.svid: {e}")

# ------------------------ Health (как было) ----------------------
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

# ------------------------ /data (как было) -----------------------
DATA_DIR = Path(os.getcwd()).resolve() / "data"
VOICE_DATA_DIR = DATA_DIR / "voicerecorder"
try:
    VOICE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
    log.info(f"Mounted /data static from: {VOICE_DATA_DIR}")
except Exception as e:
    log.warning("Could not mount data dir as static: %s", e)

from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse
from pathlib import Path
import os

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

@app.get(f"{MOUNT_PATH.rstrip('/')}/.static-check", response_class=JSONResponse)
def static_check():
    return {
        "mounted": bool(STATIC_ROOT and STATIC_ROOT.exists()),
        "static_root": str(STATIC_ROOT) if STATIC_ROOT else None,
        "base_path": MOUNT_PATH,
        "cwd": os.getcwd(),
    }
