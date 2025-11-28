from __future__ import annotations

import os
from typing import Optional, Dict, Any

import httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr

router = APIRouter()

# ---------------------------------------------------------
# Конфиг
# ---------------------------------------------------------
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or ""
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or ""

HTTP_TIMEOUT = 10.0

# Куки для access/refresh токенов.
# Если хочешь — можешь переопределить через переменные окружения.
ACCESS_COOKIE = os.getenv("AUTH_ACCESS_COOKIE", "sv_access_token")
REFRESH_COOKIE = os.getenv("AUTH_REFRESH_COOKIE", "sv_refresh_token")

COOKIE_DEFAULTS = dict(
    httponly=True,
    secure=True,
    samesite="lax",
    path="/",
    max_age=60 * 60 * 24 * 7,  # 7 дней
)


# ---------------------------------------------------------
# Модели запросов
# ---------------------------------------------------------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    data: Optional[Dict[str, Any]] = None  # попадёт в user_metadata


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr


class ChangePasswordRequest(BaseModel):
    old_password: Optional[str] = None  # можно не передавать, но лучше передавать
    new_password: str


# ---------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------
def _require_supabase() -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase config is not set")


def _get_tokens_from_request(req: Request) -> Dict[str, Optional[str]]:
    cookies = req.cookies or {}
    return {
        "access": cookies.get(ACCESS_COOKIE),
        "refresh": cookies.get(REFRESH_COOKIE),
    }


def _set_auth_cookies(resp: JSONResponse, access_token: str, refresh_token: str) -> None:
    resp.set_cookie(ACCESS_COOKIE, access_token, **COOKIE_DEFAULTS)
    resp.set_cookie(REFRESH_COOKIE, refresh_token, **COOKIE_DEFAULTS)


def _clear_auth_cookies(resp: JSONResponse) -> None:
    resp.delete_cookie(ACCESS_COOKIE, path="/")
    resp.delete_cookie(REFRESH_COOKIE, path="/")


async def _supabase_post(path: str, json: Dict[str, Any]) -> httpx.Response:
    _require_supabase()
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        return await client.post(url, headers=headers, json=json)


async def _supabase_get(path: str, headers_extra: Optional[Dict[str, str]] = None) -> httpx.Response:
    _require_supabase()
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Accept": "application/json",
    }
    if headers_extra:
        headers.update(headers_extra)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        return await client.get(url, headers=headers)


async def _supabase_put(path: str, json: Dict[str, Any], headers_extra: Optional[Dict[str, str]] = None) -> httpx.Response:
    _require_supabase()
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    if headers_extra:
        headers.update(headers_extra)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        return await client.put(url, headers=headers, json=json)


async def _fetch_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Чтение профиля из таблицы profiles через PostgREST.
    Если таблица/правила безопасности не позволяют — тихо возвращаем None.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None

    url = f"{SUPABASE_URL}/rest/v1/profiles"
    params = {"id": f"eq.{user_id}", "limit": "1", "select": "*"}
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
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


def _normalize_role(raw_role: Optional[str]) -> str:
    if not raw_role:
        return "guest"
    s = str(raw_role).strip().strip("'\" ").lower()
    if s in ("user", "authenticated"):
        return "user"
    if s in ("admin", "superadmin", "root"):
        return "admin"
    return "guest"


def _compute_level(role: str) -> Dict[str, Any]:
    """
    Простая карта уровней.
    guest: 1
    user: 2
    admin: 10
    """
    if role == "admin":
        return {"level": 10, "level_code": "admin"}
    if role == "user":
        return {"level": 2, "level_code": "user"}
    return {"level": 1, "level_code": "guest"}


def _merge_user(auth_user: Dict[str, Any], profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    uid = auth_user.get("id")
    email = auth_user.get("email") or (auth_user.get("user_metadata") or {}).get("email")
    name = (auth_user.get("user_metadata") or {}).get("name") or email

    profile = profile or {}
    role = _normalize_role(profile.get("role") or (auth_user.get("user_metadata") or {}).get("role"))
    is_guest = bool(profile.get("is_guest", False))

    merged = {
        "id": uid,
        "email": email or "",
        "phone": auth_user.get("phone") or "",
        "role": role,
        "name": name or "",
        "avatar": (auth_user.get("user_metadata") or {}).get("avatar") or "",
        "is_guest": is_guest,
        "created_at": profile.get("created_at") or auth_user.get("created_at"),
    }

    return merged


# ---------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------


@router.post("/register")
async def register(req: RegisterRequest):
    """
    Регистрация пользователя через Supabase.
    В Supabase создаётся пользователь, в user_metadata попадут данные из req.data.
    """
    _require_supabase()

    payload = {
        "email": req.email,
        "password": req.password,
    }
    if req.data:
        payload["data"] = req.data

    r = await _supabase_post("/auth/v1/signup", payload)

    if r.status_code not in (200, 201):
        try:
            data = r.json()
            msg = data.get("msg") or data.get("message") or data.get("error_description") or str(data)
        except Exception:
            msg = r.text
        raise HTTPException(status_code=r.status_code, detail=msg)

    return {"ok": True, "signup": r.json()}


@router.post("/login")
async def login(req: LoginRequest):
    """
    Логин: email + password.
    Возвращает user_auth, user_profile, user_merged и ставит куки с токенами.
    """
    _require_supabase()

    # 1) Получаем access/refresh токены
    token_url = "/auth/v1/token?grant_type=password"
    r = await _supabase_post(token_url, {"email": req.email, "password": req.password})

    if r.status_code not in (200, 201):
        try:
            data = r.json()
            msg = data.get("msg") or data.get("message") or data.get("error_description") or str(data)
        except Exception:
            msg = r.text
        raise HTTPException(status_code=401, detail=msg)

    token_data = r.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")

    if not access_token or not refresh_token:
        raise HTTPException(status_code=500, detail="Auth tokens not received from Supabase")

    # 2) Получаем данные пользователя (auth)
    r_user = await _supabase_get("/auth/v1/user", headers_extra={"Authorization": f"Bearer {access_token}"})
    if r_user.status_code != 200:
        raise HTTPException(status_code=500, detail="Cannot fetch user from Supabase")
    user_auth = r_user.json()

    # 3) Пытаемся достать профиль
    user_id = user_auth.get("id")
    user_profile = await _fetch_profile(user_id) if user_id else None

    # 4) Собираем merged
    user_merged = _merge_user(user_auth, user_profile)

    resp = JSONResponse(
        {
            "ok": True,
            "user_auth": user_auth,
            "user_profile": user_profile,
            "user_merged": user_merged,
        }
    )
    _set_auth_cookies(resp, access_token, refresh_token)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.get("/me")
async def me(request: Request):
    """
    Возвращает информацию о текущем пользователе на основе access-токена в куках.
    """
    tokens = _get_tokens_from_request(request)
    access = tokens["access"]

    if not access:
        return {
            "loggedIn": False,
            "level": 1,
            "level_code": "guest",
            "user_merged": None,
            "user_auth": None,
            "user_profile": None,
        }

    r_user = await _supabase_get("/auth/v1/user", headers_extra={"Authorization": f"Bearer {access}"})

    if r_user.status_code != 200:
        # токен протух → считаем гостем
        return {
            "loggedIn": False,
            "level": 1,
            "level_code": "guest",
            "user_merged": None,
            "user_auth": None,
            "user_profile": None,
        }

    user_auth = r_user.json()
    user_profile = await _fetch_profile(user_auth.get("id")) if user_auth.get("id") else None
    user_merged = _merge_user(user_auth, user_profile)

    role = user_merged["role"]
    lvl = _compute_level(role)

    return {
        "loggedIn": True,
        **lvl,
        "user_merged": user_merged,
        "user_auth": user_auth,
        "user_profile": user_profile,
    }


@router.post("/logout")
async def logout(request: Request):
    """
    Выход: чистим куки и мягко дергаем Supabase logout.
    """
    tokens = _get_tokens_from_request(request)
    access = tokens["access"]

    resp = JSONResponse({"ok": True})
    _clear_auth_cookies(resp)
    resp.headers["Cache-Control"] = "no-store"

    if access and SUPABASE_URL and SUPABASE_ANON_KEY:
        try:
            url = f"{SUPABASE_URL}/auth/v1/logout"
            headers = {"Authorization": f"Bearer {access}", "apikey": SUPABASE_ANON_KEY}
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                await client.post(url, headers=headers)
        except Exception:
            # Это не критично — главное, что куки мы уже стерли
            pass

    return resp


@router.post("/reset")
async def reset_password(req: ResetPasswordRequest):
    """
    Сброс пароля по email.
    Supabase отправляет пользователю письмо со ссылкой на сброс.
    """
    _require_supabase()

    url = f"{SUPABASE_URL}/auth/v1/recover"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    body = {"email": req.email}

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.post(url, headers=headers, json=body)

    if r.status_code not in (200, 204):
        try:
            data = r.json()
            msg = data.get("msg") or data.get("message") or data.get("error_description") or str(data)
        except Exception:
            msg = r.text
        raise HTTPException(status_code=r.status_code, detail=msg)

    return {"ok": True, "sent": True}


@router.post("/change-password")
async def change_password(request: Request, req: ChangePasswordRequest):
    """
    Смена пароля БЕЗ email — по текущей сессии.
    Логика:
      1) Берём access-токен из куки.
      2) Через /auth/v1/user узнаём email.
      3) Если передан old_password — проверяем его через /token?grant_type=password.
      4) Делаем PUT /auth/v1/user с новым паролем.
    """
    tokens = _get_tokens_from_request(request)
    access = tokens["access"]
    if not access:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # 1) Узнаём текущего пользователя
    r_user = await _supabase_get("/auth/v1/user", headers_extra={"Authorization": f"Bearer {access}"})
    if r_user.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")

    user_auth = r_user.json()
    email = user_auth.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="User email is unknown")

    # 2) Если есть old_password — проверим его
    if req.old_password:
        r_check = await _supabase_post(
            "/auth/v1/token?grant_type=password",
            {"email": email, "password": req.old_password},
        )
        if r_check.status_code not in (200, 201):
            raise HTTPException(status_code=401, detail="Old password is incorrect")

    # 3) Ставим новый пароль
    r_change = await _supabase_put(
        "/auth/v1/user",
        {"password": req.new_password},
        headers_extra={"Authorization": f"Bearer {access}"},
    )

    if r_change.status_code != 200:
        try:
            data = r_change.json()
            msg = data.get("msg") or data.get("message") or data.get("error_description") or str(data)
        except Exception:
            msg = r_change.text
        raise HTTPException(status_code=r_change.status_code, detail=msg)

    return {"ok": True}
