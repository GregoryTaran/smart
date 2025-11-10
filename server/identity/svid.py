# SERVER/identity/svid.py
from fastapi import APIRouter, Request, Response
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/identity", tags=["identity"])

@router.post("/visitor/init")
async def visitor_init(req: Request):
    vid = f"v_{uuid.uuid4().hex[:16]}"
    return {
        "visitor_id": vid,
        "level": 1,
        "ts": datetime.now(timezone.utc).isoformat()
    }

@router.get("/me")
async def me():
    # Пока без аутентификации — возвращаем базовый уровень гостя
    return {"kind": "visitor", "level": 1}

@router.post("/visitor/heartbeat")
async def visitor_heartbeat():
    return Response(status_code=204)
