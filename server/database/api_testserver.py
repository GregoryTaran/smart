from fastapi import APIRouter
from datetime import datetime
import os

router = APIRouter()

@router.get("/ping")
def ping():
    return {
        "ok": True,
        "service": "fastapi",
        "time": datetime.utcnow().isoformat() + "Z",
        "env": {"dev_bypass_auth": os.environ.get("DEV_BYPASS_AUTH", "false")},
        "message": "Server is alive",
    }
