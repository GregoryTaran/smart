from __future__ import annotations

import os
from typing import Optional, Dict, Any

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx

# =========================================================
# Конфиг
# =========================================================
router = APIRouter()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or ""
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""  # если понадобится

# Имена куки, как мы договорились
ACCESS_COOKIE = "sb-access-token"
REFRESH_COOKIE = "sb-refresh-token"

# Безопасность куки (на проде secure=True при HTTPS)
COOKIE_KW = dict(
    httponly=True,
    samesite="lax",
    secure=True,   # локально можно поменять на False, если без HTTPS
    path="/",
)

HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


# =========================================================
# Helpers
# =========================================================
def _require_supabase():
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_ANON_KEY not configured")

def _normalize_merged(auth_user: Dict[str, Any], db_profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Сжать данные в удобный профиль для UI: id, email, phone, role, name, avatar (+ бизнес-поля из profiles)
    """
    umeta = (auth_user.get("user_metadata") or {}) if auth_user else {}
    ameta = (auth_user.get("app_metadata") or {})  if auth_user else {}

    merged = {
        "id":    auth_user.get("id"),
        "email": auth_user.get("email"),
        "phone": auth_user.get("phone"),
        "role":  ameta.get("role") or ameta.get("roles") or "user",
        "name":  umeta.get("name") or umeta.get("full_name") or "",
        "avatar": umeta.get("avatar_url") or umeta.get("avatar") or "",
    }

    if db_profile:
        # Переопределяем/добавляем поля из таблицы профилей
        merged["name"]   = db_profile.get("name")   or merged["name"]
        merged["avatar"] = db_profile.get("avatar") or merged["avatar"]
        merged["role"]   = db_profile.get("role")   or merged["role"]
        for k, v in db_profile.items():
            if k not in merged and v is not None:
                merged[k] = v

    return merged


async def _sb_auth_user_by_access(access_token: str) -> Optional[Dict[str, Any]]:
    """
    GET /auth/v1/user — вернуть полный объект пользователя из Supabase Auth.
    """
    _require_supabase()
    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {"Authorization": f"Bearer {access_token}", "apikey": SUPABASE_ANON_KEY}
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            return None
        return r.json()


async def _sb_fetch_profile_from_table(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Опционально: достать профиль из PostgREST таблицы `profiles`.
    Требует корректной RLS для anon key (или использовать service-role в headers).
    """
    if not user_id:
        return None
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None

    url = f"{SUPABASE_URL}/rest/v1/profiles"
    params = {"select": "*", "id": f"eq.{user_id}", "limit": "1"}
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",  # для RLS на чтение часто хватает anon key
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.get(url, params=params, headers=headers)
        if r.status_code != 200:
            return None
        data = r.json()
        if isinstance(data, list) and data:
            return data[0]
        return None


def _set_auth_cookies(resp: JSONResponse, access_token: str, refresh_token: str) -> None:
    resp.set_cookie(ACCESS_COOKIE, access_token, **COOKIE_KW)
    resp.set_cookie(REFRESH_COOKIE, refresh_token, **COOKIE_KW)


def _clear_auth_cookies(resp: JSONResponse) -> None:
    resp.delete_cookie(ACCESS_COOKIE, path="/")
    resp.delete_cookie(REFRESH_COOKIE, path="/")


# =========================================================
# Endpoints
# =========================================================
@router.post("/register")
async def register(payload: Dict[str, Any]):
    """
    Регистрация пользователя через Supabase.
    Ожидаем JSON: { "email": "...", "password": "...", "data": { ...user_metadata... } }
    Email-верификация в вашем проекте выключена — аккаунт активен сразу.
    """
    _require_supabase()
    email = (payload or {}).get("email")
    password = (payload or {}).get("password")
    user_data = (payload or {}).get("data") or {}

    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")

    url = f"{SUPABASE_URL}/auth/v1/signup"
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    body = {"email": email, "password": password, "data": user_data}

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.post(url, headers=headers, json=body)

    # Supabase при signup НЕ всегда возвращает токены; обычно просто user.
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=r.status_code, detail=r.text)

    # Возвращаем что прислал Supabase (user), а логин делаем отдельным шагом.
    resp = JSONResponse({"ok": True, "signup": r.json()})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.post("/login")
async def login(payload: Dict[str, Any]):
    """
    Логин по email+password: ставим HttpOnly куки с access/refresh,
    возвращаем компактный профиль для удобства (по желанию фронта).
    Ожидаем JSON: { "email": "...", "password": "..." }
    """
    _require_supabase()
    email = (payload or {}).get("email")
    password = (payload or {}).get("password")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")

    # 1) получить токены
    token_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    body = {"email": email, "password": password}

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        tr = await client.post(token_url, headers=headers, json=body)

    if tr.status_code != 200:
        raise HTTPException(status_code=401, detail="invalid email or password")

    tokens = tr.json()  # содержит access_token, refresh_token, token_type, expires_in, user
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")

    if not access_token or not refresh_token:
        raise HTTPException(status_code=500, detail="auth tokens not returned")

    # 2) получить полный профиль из /auth/v1/user
    auth_user = await _sb_auth_user_by_access(access_token)
    if not auth_user:
        raise HTTPException(status_code=401, detail="unable to fetch user profile")

    # 3) опционально — профиль из таблицы
    db_profile = await _sb_fetch_profile_from_table(auth_user.get("id"))
    merged = _normalize_merged(auth_user, db_profile)

    # 4) ответ + куки
    resp = JSONResponse({
        "ok": True,
        "user_auth": auth_user,
        "user_profile": db_profile,
        "user_merged": merged,
    })
    _set_auth_cookies(resp, access_token, refresh_token)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.get("/me")
async def me(request: Request):
    """
    Проверка текущей сессии по HttpOnly кукам.
    Возвращаем максимум:
      {
        "loggedIn": true,
        "user_auth": { ...полностью из /auth/v1/user... },
        "user_profile": { ...из таблицы profiles... } | null,
        "user_merged": { ...компакт для UI... }
      }
    Или {"loggedIn": false}
    """
    access = request.cookies.get(ACCESS_COOKIE)
    if not access:
        return JSONResponse({"loggedIn": False}, headers={"Cache-Control": "no-store"})

    auth_user = await _sb_auth_user_by_access(access)
    if not auth_user:
        return JSONResponse({"loggedIn": False}, headers={"Cache-Control": "no-store"})

    db_profile = await _sb_fetch_profile_from_table(auth_user.get("id"))
    merged = _normalize_merged(auth_user, db_profile)

    resp = JSONResponse({
        "loggedIn": True,
        "user_auth": auth_user,
        "user_profile": db_profile,
        "user_merged": merged,
    })
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.post("/logout")
async def logout(request: Request):
    """
    Логаут: стираем HttpOnly-куки.
    Дополнительно пробуем дернуть Supabase /auth/v1/logout с access токеном (мягко).
    """
    access = request.cookies.get(ACCESS_COOKIE)
    resp = JSONResponse({"ok": True})
    _clear_auth_cookies(resp)
    resp.headers["Cache-Control"] = "no-store"

    # Мягкая попытка инвалидировать сессию в Supabase (не критично, если не выйдет)
    if access and SUPABASE_URL and SUPABASE_ANON_KEY:
        try:
            url = f"{SUPABASE_URL}/auth/v1/logout"
            headers = {"Authorization": f"Bearer {access}", "apikey": SUPABASE_ANON_KEY}
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                await client.post(url, headers=headers)
        except Exception:
            pass

    return resp
