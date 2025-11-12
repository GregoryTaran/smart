# --------------------------------------------------------------
# 🚀 SMART VISION — MAIN SERVER ENTRY
# Author: Greg Taran
# Purpose: Central FastAPI backend with modular mount structure
# --------------------------------------------------------------

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse
from pathlib import Path
import logging, os

# ------------------------ LOGGING ------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s: %(message)s"
)
log = logging.getLogger("SMART_MAIN")

# ------------------------ APP CORE ------------------------
app = FastAPI(title="SMART Backend", version="1.0.0 🌈")

# ------------------------ CORS ------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------ ROUTERS ------------------------
# 🎙️ VoiceRecorder
try:
    from voicerecorder.voicerecorder import app as voicerecorder_app
    app.mount("/api", voicerecorder_app)
    log.info("🎧 VoiceRecorder module mounted successfully!")
except Exception as e:
    log.warning(f"💥 Failed to mount VoiceRecorder module: {e}")

# 🧩 Other modules (auth, svid, db, etc.) можно подключать по аналогии
# ...

# ------------------------ HEALTH ------------------------
@app.get("/health")
def health():
    return {"status": "ok", "module": "SMART Backend"}

@app.get("/api/info")
def info():
    return JSONResponse({
        "service": "smart-backend",
        "env": os.environ.get("ENV", "dev"),
        "python_version": os.environ.get("PYTHON_VERSION", ""),
    })

# ------------------------ DATA DIR ------------------------
DATA_DIR = Path(os.getcwd()).resolve() / "data"
VOICE_DATA_DIR = DATA_DIR / "voicerecorder"
try:
    VOICE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
    log.info(f"📂 Mounted /data at: {VOICE_DATA_DIR}")
except Exception as e:
    log.warning(f"⚠️ Could not mount /data: {e}")

# ------------------------ FRONTEND STATIC ------------------------
SMART_FRONT_ROOT = os.environ.get("SMART_FRONT_ROOT", "").strip()
MOUNT_PATH = os.environ.get("SMART_MOUNT_PATH", "/").strip() or "/"

candidates = [
    Path(SMART_FRONT_ROOT) if SMART_FRONT_ROOT else None,
    Path(os.getcwd()) / "smart",
    Path(__file__).resolve().parents[1] / "smart",
    Path(__file__).resolve().parents[1] / "Smart",
]

STATIC_ROOT = next((p.resolve() for p in candidates if p and p.exists()), None)

if STATIC_ROOT:
    app.mount(MOUNT_PATH, StaticFiles(directory=str(STATIC_ROOT), html=True), name="frontend")
    log.info(f"🧱 Static frontend mounted from: {STATIC_ROOT}")
else:
    log.warning(f"❌ Frontend root not found. Tried: {[str(p) for p in candidates if p]}")

@app.get(f"{MOUNT_PATH.rstrip('/')}/.static-check")
def static_check():
    return {
        "mounted": bool(STATIC_ROOT and STATIC_ROOT.exists()),
        "root": str(STATIC_ROOT),
        "cwd": os.getcwd(),
    }

# --------------------------------------------------------------
log.info("✨ SMART Backend fully initialized and glowing! 🚀")
