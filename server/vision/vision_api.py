from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, Any
import uuid
import datetime
import os
import httpx

router = APIRouter(prefix="/api/vision", tags=["vision"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON = os.getenv("SUPABASE_ANON_KEY")

T_VISION = "vision"
T_STEPS = "vision_steps"

# ============================================================
# AUTH HELPERS
# ============================================================

async def get_current_user(request: Request) -> Dict[str, Any]:
    """Возвращает auth_user из Supabase по access cookie."""

    access = request.cookies.get("sb-access-token")
    if not access:
        return None

    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {access}"
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            return None

        try:
            data = r.json()
        except:
            return None

        if not data or "id" not in data:
            return None

        return data


# ============================================================
# SUPABASE HELPERS
# ============================================================

async def sb_select_one(table: str, filters: Dict[str, str]) -> Dict[str, Any]:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {"select": "*", "limit": "1"}
    params.update(filters)

    headers = {
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}"
    }

    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params, headers=headers)

    if r.status_code != 200:
        return None

    data = r.json()
    return data[0] if data else None


async def sb_select_list(table: str, filters: Dict[str, str]) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {"select": "*", "order": "created_at.desc"}
    params.update(filters)

    headers = {
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}"
    }

    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params, headers=headers)

    if r.status_code != 200:
        return []

    return r.json()


async def sb_insert(table: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient() as client:
        r = await client.post(url, json=payload, headers=headers)

    if r.status_code >= 300:
        raise HTTPException(r.status_code, "Ошибка Supabase insert")

    return r.json()[0] if r.json() else payload


async def sb_update(table: str, filters: Dict[str, str], payload: Dict[str, Any]):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = filters

    headers = {
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient() as client:
        r = await client.patch(url, params=params, json=payload, headers=headers)

    if r.status_code >= 300:
        raise HTTPException(r.status_code, "Ошибка Supabase update")

    return True


# ============================================================
# CREATE VISION
# ============================================================

@router.post("/create")
async def create_vision(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(401, "Требуется авторизация")

    vision_id = str(uuid.uuid4())
    payload = {
        "vision_id": vision_id,
        "user_id": user["id"],
        "title": "Новая визия",
        "created_at": datetime.datetime.utcnow().isoformat()
    }

    await sb_insert(T_VISION, payload)

    return {"ok": True, "vision_id": vision_id}


# ============================================================
# LIST VISIONS
# ============================================================

@router.get("/list")
async def list_visions(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(401, "Требуется авторизация")

    data = await sb_select_list(T_VISION, {"user_id": f"eq.{user['id']}"})

    return {"ok": True, "visions": data}


# ============================================================
# GET VISION
# ============================================================

@router.get("/{vision_id}")
async def get_vision(vision_id: str, request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(401, "Требуется авторизация")

    row = await sb_select_one(T_VISION, {
        "vision_id": f"eq.{vision_id}",
        "user_id": f"eq.{user['id']}"
    })

    if not row:
        raise HTTPException(404, "Визия не найдена")

    steps = await sb_select_list(T_STEPS, {"vision_id": f"eq.{vision_id}"})

    return {
        "ok": True,
        "vision_id": vision_id,
        "title": row["title"],
        "steps": steps
    }


# ============================================================
# RENAME VISION
# ============================================================

@router.post("/rename")
async def rename_vision(payload: Dict[str, Any], request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(401, "Требуется авторизация")

    vision_id = payload.get("vision_id")
    title = payload.get("title")

    if not vision_id or not title:
        raise HTTPException(400, "Неверный запрос")

    await sb_update(
        T_VISION,
        {"vision_id": f"eq.{vision_id}", "user_id": f"eq.{user['id']}"},
        {"title": title}
    )

    return {"ok": True}


# ============================================================
# ADD STEP
# ============================================================

@router.post("/step")
async def add_step(payload: Dict[str, Any], request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(401, "Требуется авторизация")

    vision_id = payload.get("vision_id")
    text = payload.get("user_text")

    if not vision_id or not text:
        raise HTTPException(400, "Неверные данные")

    # проверяем владельца визии
    row = await sb_select_one(T_VISION, {
        "vision_id": f"eq.{vision_id}",
        "user_id": f"eq.{user['id']}"
    })

    if not row:
        raise HTTPException(404, "Визия не найдена")

    step_payload = {
        "vision_id": vision_id,
        "user_id": user["id"],
        "user_text": text,
        "ai_text": None,  # позже бот может заполнить
        "created_at": datetime.datetime.utcnow().isoformat()
    }

    await sb_insert(T_STEPS, step_payload)

    return {"ok": True}
