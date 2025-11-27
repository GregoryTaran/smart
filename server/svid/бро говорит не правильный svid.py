import os
import uuid
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Request, Response, HTTPException, status
from fastapi.responses import JSONResponse
from supabase import create_client, Client
from pydantic import BaseModel, EmailStr

# -------------------------------------------------
# Конфиг
# -------------------------------------------------
SESSION_COOKIE_NAME = "sv_session"
SESSION_TTL_HOURS = 24  # сколько живёт сессия

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Supabase env vars are not set (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")

_supabase: Optional[Client] = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _supabase


router = APIRouter(tags=["svid-auth"])


# -------------------------------------------------
# Вспомогательное: уровень → код
# -------------------------------------------------
def level_to_code(level: int) -> str:
    if level <= 1:
        return "guest"
    if level == 2:
        return "user"
    if level == 3:
        return "paid"
    if level >= 4:
        return "super"
    return "user"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


# -------------------------------------------------
# Миддлварь: на каждый запрос подтягиваем auth
# -------------------------------------------------
async def auth_middleware(request: Request, call_next):
    """
    Читает sv_session из куки, ищет сессию в auth_sessions,
    подтягивает пользователя из users и кладёт данные в request.state.auth
    """
    supabase = get_supabase()

    # Значения по умолчанию: гость
    guest_auth = {
        "is_authenticated": False,
        "user_id": None,
        "level": 1,
        "level_code": "guest",
        "email": None,
        "display_name": None,
    }
    request.state.user = None
    request.state.auth = guest_auth

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        # Нет куки → гость
        response = await call_next(request)
        return response

    try:
        # Проверяем сессию
        now_iso = iso(now_utc())
        sess_resp = (
            supabase.table("auth_sessions")
            .select("*")
            .eq("session_id", session_id)
            .eq("is_active", True)
            .gt("expires_at", now_iso)
            .single()
            .execute()
        )

        session = getattr(sess_resp, "data", None)
        if not session:
            # нет валидной сессии → гость
            response = await call_next(request)
            return response

        user_id = session.get("user_id")
        if not user_id:
            response = await call_next(request)
            return response

        # Подтягиваем пользователя
        user_resp = (
            supabase.table("users")
            .select("user_id, email, level, display_name")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        user = getattr(user_resp, "data", None)
        if not user:
            response = await call_next(request)
            return response

        level = user.get("level") or 1
        if not isinstance(level, int):
            try:
                level = int(level)
            except Exception:
                level = 1

        auth_obj = {
            "is_authenticated": True,
            "user_id": user.get("user_id"),
            "level": level,
            "level_code": level_to_code(level),
            "email": user.get("email"),
            "display_name": user.get("display_name"),
        }

        request.state.user = user
        request.state.auth = auth_obj

        # Обновим last_seen_at асинхронно (не ждём)
        try:
            supabase.table("auth_sessions").update(
                {"last_seen_at": now_iso}
            ).eq("session_id", session_id).execute()
        except Exception:
            pass

    except Exception:
        # Любая ошибка → не ломаем запрос, просто гость
        request.state.user = None
        request.state.auth = guest_auth

    response = await call_next(request)
    return response


# -------------------------------------------------
# Хелперы для сессий
# -------------------------------------------------
def create_session_record(user_id: str, request: Request) -> str:
    supabase = get_supabase()
    session_id = str(uuid.uuid4())
    now_dt = now_utc()
    expires_dt = now_dt + timedelta(hours=SESSION_TTL_HOURS)

    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")

    _ = (
        supabase.table("auth_sessions")
        .insert(
            {
                "session_id": session_id,
                "user_id": user_id,
                "created_at": iso(now_dt),
                "last_seen_at": iso(now_dt),
                "expires_at": iso(expires_dt),
                "ip_address": ip,
                "user_agent": ua,
                "is_active": True,
            }
        )
        .execute()
    )

    return session_id


def deactivate_session(session_id: str):
    supabase = get_supabase()
    try:
        (
            supabase.table("auth_sessions")
            .update({"is_active": False})
            .eq("session_id", session_id)
            .execute()
        )
    except Exception:
        pass


# -------------------------------------------------
# Модели запросов
# -------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class ResetRequest(BaseModel):
    email: EmailStr


# -------------------------------------------------
# /api/auth/register
# -------------------------------------------------
@router.post("/register")
async def register_endpoint(payload: RegisterRequest):
    """
    Регистрация нового пользователя:
    - email должен быть уникален
    - пароль сохраняем в поле users.password (plain text)
    - можно потом начать заполнять password_hash
    - level = 2 (обычный пользователь)
    """
    supabase = get_supabase()

    # Проверяем, нет ли пользователя с таким email
    try:
        existing_resp = (
            supabase.table("users")
            .select("user_id")
            .eq("email", payload.email)
            .execute()
        )
        existing = getattr(existing_resp, "data", None) or []
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пользователь с таким email уже существует",
            )
    except HTTPException:
        raise
    except Exception:
        # Если проверка сломалась, лучше явно сказать пользователю
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ошибка при проверке существующего пользователя",
        )

    user_id = str(uuid.uuid4())
    now_dt = now_utc()

    # Вставляем пользователя
    try:
        (
            supabase.table("users")
            .insert(
                {
                    "user_id": user_id,
                    "email": payload.email,
                    "password": payload.password,
                    # password_hash можно заполнить позже, когда уйдём от plain
                    "password_hash": None,
                    "display_name": payload.name,
                    "level": 2,  # обычный пользователь
                    "created_at": iso(now_dt),
                }
            )
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Не удалось создать пользователя: {e}",
        )

    return {"ok": True, "user_id": user_id}


# -------------------------------------------------
# /api/auth/login
# -------------------------------------------------
@router.post("/login")
async def login_endpoint(payload: LoginRequest, request: Request, response: Response):
    """
    Логин по email + password.

    ВАЖНО: сейчас проверяем пароль по полю users.password (plain text),
    как ты и просил. Позже можно будет переключиться на password_hash/bcrypt.
    """
    supabase = get_supabase()

    # 1. Ищем пользователя по email
    try:
        user_resp = (
            supabase.table("users")
            .select("user_id, email, level, password")
            .eq("email", payload.email)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user = getattr(user_resp, "data", None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # 2. Сравниваем пароль (plain text)
    stored_pw = user.get("password") or ""
    if stored_pw != payload.password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user_id = user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="User has no ID")

    # 3. Создаём сессию
    session_id = create_session_record(user_id, request)

    # 4. Ставим куку
    secure_flag = request.url.scheme == "https"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        secure=secure_flag,
        samesite="lax",
        max_age=SESSION_TTL_HOURS * 3600,
        path="/",
    )

    return {"ok": True}


# -------------------------------------------------
# /api/auth/logout
# -------------------------------------------------
@router.post("/logout")
async def logout_endpoint(request: Request, response: Response):
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        deactivate_session(session_id)

    # Стираем куку
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
    )

    return {"ok": True}


# -------------------------------------------------
# /api/auth/reset
# -------------------------------------------------
def generate_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


@router.post("/reset")
async def reset_password_endpoint(payload: ResetRequest):
    """
    Сброс пароля:
    - ищем пользователя по email
    - генерируем новый пароль
    - пишем его в users.password (plain text)
    - возвращаем new_password в ответе
    """
    supabase = get_supabase()

    # Ищем пользователя
    try:
        user_resp = (
            supabase.table("users")
            .select("user_id, email")
            .eq("email", payload.email)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь с таким email не найден",
        )

    user = getattr(user_resp, "data", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь с таким email не найден",
        )

    user_id = user.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Пользователь повреждён (нет user_id)",
        )

    new_password = generate_password(10)

    # Обновляем пароль в базе (plain text)
    try:
        (
            supabase.table("users")
            .update(
                {
                    "password": new_password,
                    # password_hash можно будет обновлять, когда перейдем на bcrypt
                    "password_hash": None,
                }
            )
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Не удалось обновить пароль: {e}",
        )

    return {"ok": True, "new_password": new_password}


# -------------------------------------------------
# /api/auth/session
# -------------------------------------------------
@router.get("/session")
async def session_endpoint(request: Request):
    """
    Возвращает объект авторизации для фронта.
    То, что читает твой скрипт в <head> и кладёт в window.SV_AUTH.
    """
    auth = getattr(request.state, "auth", None)
    if not auth:
        auth = {
            "is_authenticated": False,
            "user_id": None,
            "level": 1,
            "level_code": "guest",
            "email": None,
            "display_name": None,
        }
    return JSONResponse(auth)
