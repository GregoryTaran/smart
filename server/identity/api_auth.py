# --- imports ---
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import os, httpx
from typing import Optional, Dict, Any

# если supabase-py уже есть в проекте
from supabase import create_client, Client

router = APIRouter(prefix="/api/auth", tags=["auth"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

ACCESS_COOKIE = "sb-access-token"
REFRESH_COOKIE = "sb-refresh-token"

# ---------- Supabase client (для таблицы profiles — опционально) ----------
_SB: Optional[Client] = None
def _sb() -> Client:
    global _SB
    if _SB is None:
        if not SUPABASE_URL or not SUPABASE_ANON_KEY:
            raise RuntimeError("SUPABASE_URL / SUPABASE_ANON_KEY not set")
        _SB = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _SB

# ---------- HTTP helper ----------
_TIMEOUT = httpx.Timeout(7.0, connect=3.0)

async def _fetch_auth_user(access_token: str) -> Optional[Dict[str, Any]]:
    """
    Возвращает ПОЛНЫЙ объект пользователя из Supabase Auth (/auth/v1/user).
    Там есть: id, email, phone, identities, app_metadata, user_metadata,
    обновления дат, и прочие поля. Мы возвращаем 'как есть'.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "apikey": SUPABASE_ANON_KEY,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            return None
        return r.json()

def _normalize_merged(auth_user: Dict[str, Any], db_profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Собираем УДОБНЫЙ 'merged' профиль для UI.
    Берём популярные поля из auth_user и поверх накрываем из db_profile.
    """
    umeta = (auth_user.get("user_metadata") or {}) if auth_user else {}
    ameta = (auth_user.get("app_metadata") or {})  if auth_user else {}

    # Базовые — из Auth
    merged = {
        "id":    auth_user.get("id"),
        "email": auth_user.get("email"),
        "phone": auth_user.get("phone"),
        "role":  ameta.get("role") or ameta.get("roles") or "user",
        "name":  umeta.get("name") or umeta.get("full_name") or "",
        "avatar": umeta.get("avatar_url") or umeta.get("avatar") or "",
    }

    # Поверх — из таблицы профилей (если есть)
    if db_profile:
        # подставь свои поля таблицы
        merged["name"]   = db_profile.get("name")   or merged["name"]
        merged["avatar"] = db_profile.get("avatar") or merged["avatar"]
        merged["role"]   = db_profile.get("role")   or merged["role"]

        # можно прокинуть любые бизнес-поля
        for k, v in db_profile.items():
            if k not in merged and v is not None:
                merged[k] = v

    return merged

async def _fetch_db_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Опционально: достаём профиль из таблицы 'profiles' (переименуй под себя).
    Если таблицы нет — можно вернуть None.
    """
    try:
        sb = _sb()
        res = sb.table("profiles").select("*").eq("id", user_id).limit(1).execute()
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        return None

# ---------- /api/auth/me ----------
@router.get("/me")
async def me(request: Request):
    """
    Источник истины для фронта.
    Если кука есть и валидна — возвращаем максимум:
      {
        "loggedIn": true,
        "user_auth": {... полный объект из /auth/v1/user ...},
        "user_profile": {... запись из таблицы profiles или null ...},
        "user_merged": {... компакт для UI ...}
      }
    Иначе: {"loggedIn": false}
    """
    access = request.cookies.get(ACCESS_COOKIE)
    if not access:
        return JSONResponse({"loggedIn": False}, headers={"Cache-Control": "no-store"})

    auth_user = await _fetch_auth_user(access)
    if not auth_user:
        return JSONResponse({"loggedIn": False}, headers={"Cache-Control": "no-store"})

    # подтягиваем профиль из БД (если есть таблица)
    dbp = await _fetch_db_profile(auth_user.get("id"))
    merged = _normalize_merged(auth_user, dbp)

    payload = {
        "loggedIn": True,
        "user_auth": auth_user,        # полный auth пользователя (как есть)
        "user_profile": dbp,           # профиль из БД (или null)
        "user_merged": merged,         # удобная "сборка" для UI и LocalStorage
    }
    return JSONResponse(payload, headers={"Cache-Control": "no-store"})

# ---------- /api/auth/logout ----------
@router.post("/logout")
async def logout():
    """
    Стираем access/refresh HttpOnly-куки. На фронте — очистить LocalStorage.
    """
    resp = JSONResponse({"ok": True})
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        resp.delete_cookie(
            key=name,
            path="/",
            httponly=True,
            samesite="lax",
            secure=True,  # держим True на проде (HTTPS)
        )
    resp.headers["Cache-Control"] = "no-store"
    return resp
