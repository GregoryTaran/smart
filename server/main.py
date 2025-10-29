# server/main.py
# FastAPI app that serves:
# - static frontend from ../Smart (if present)
# - health endpoints (/health and /healthz)
# - a simple WebSocket echo at /ws
#
# Place this file in `server/` (it assumes your `Smart/` frontend is a sibling folder:
# repo-root/
#   Smart/
#   server/
#
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import uuid
import logging
import os

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("smart.main")

BASE = Path(__file__).resolve().parent
FRONT_DIR = BASE.parent / "Smart"  # ../Smart

app = FastAPI(title="Smart Vision — API + Static")

# Allow cross-origin requests during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production to your domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.get("/api/info")
async def info():
    return {"service": "smart", "env": dict(os.environ.get("PYTHON_VERSION", ""))}

# Simple WebSocket echo endpoint (example)
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    client_id = str(uuid.uuid4())[:8]
    log.info("WS connected: %s", client_id)
    try:
        while True:
            # this example expects text messages; adapt if you send binary audio chunks
            msg = await ws.receive_text()
            log.info("WS %s recv: %s", client_id, msg[:120])
            await ws.send_text(f"echo ({client_id}): {msg}")
    except WebSocketDisconnect:
        log.info("WS disconnected: %s", client_id)
    except Exception as e:
        log.exception("WS error: %s", e)

# If frontend folder exists, serve it.
if FRONT_DIR.exists():
    log.info("Mounting frontend from %s", FRONT_DIR)
    # Mount at root so index.html will be served at "/"
    app.mount("/", StaticFiles(directory=str(FRONT_DIR), html=True), name="static")
else:
    log.warning("Frontend directory not found at %s — static files not mounted", FRONT_DIR)
