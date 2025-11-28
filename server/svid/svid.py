from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import os, uuid
from typing import Optional, Dict, Any

# Это новая минимальная версия SVID
# Только visitor_id и уровень (1). Никаких users!

router = APIRouter(prefix="/api/svid", tags=["svid"])

# таблица visitor — одна колонка visitor_id + level
# Доступ к базе можно реализовать чем угодно (Supabase или SQLite)
# Ниже — пример под Supabase PostgREST.


SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
T_VISITOR = "visitor"


import httpx

async def _sb_get_visitor(visitor_id: str) -> Optional[Dict[str, Any]]:
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/{T_VISITOR}"
    params = {
        "select": "*",
        "visitor_id": f"eq.{visitor_id}",
        "limit": "1"
    }
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params, headers=headers)
        if r.status_code != 200:
            return None
        data = r.json()
        return data[0] if data else None


async def _sb_insert_visitor(visitor_id: str, level: int = 1) -> None:
    if not SUPABASE_URL:
        return
    url = f"{SUPABASE_URL}/rest/v1/{T_VISITOR}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "visitor_id": visitor_id,
        "level": level
    }
    async with httpx.AsyncClient() as client:
        await client.post(url, headers=headers, json=payload)


# ============================================================
# /api/svid/identify
# ============================================================

@router.post("/identify")
async def identify(payload: Dict[str, Any]):
    """Создать или получить visitor_id (уровень=1)."""

    old_vid = (payload or {}).get("visitor_id")

    # если visitor существует — возвращаем как есть
    if old_vid:
        row = await _sb_get_visitor(old_vid)
        if row:
            return {
                "ok": True,
                "visitor_id": old_vid,
                "level": int(row.get("level") or 1)
            }

    # иначе создаём новый
    new_vid = str(uuid.uuid4())
    await _sb_insert_visitor(new_vid, level=1)

    return {
        "ok": True,
        "visitor_id": new_vid,
        "level": 1
    }
