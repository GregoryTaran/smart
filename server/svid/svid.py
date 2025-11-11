# /server/svid/svid.py
# SVID — FastAPI-роутер: identify / register / login / reset / logout
# Работа с Supabase через сервисный ключ. Пароли — bcrypt.
# Таблицы (минимум):
# - VISITOR: { id(uuid) PK, fingerprint(text), tz(text), ip(text), user_id(uuid|null), created_at, updated_at }
# - USER:    { id(uuid) PK, email(text) unique, name(text), level(text), created_at, updated_at }
# - AUTH_VAULT: { user_id(uuid) PK/FK -> USER.id, password_hash(text), created_at }
#
# ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# Автор: Greg & Bro, SMART VISION 🤝

import os
import time
import uuid
from typing import Optional, Any, Dict

from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import JSONResponse

from fastapi import status as http
from fastapi.middleware.cors import CORSMiddleware

# Supabase client (v2)
from supabase import create_client, Client

# bcrypt
import bcrypt

# --- Supabase init ---
def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")
    return create_client(url, key)

sb: Client = get_supabase()

router = APIRouter(prefix="/api/svid", tags=["svid"])

# --- Models ---
class IdentifyIn(BaseModel):
    fingerprint: Optional[str] = None
    tz: Optional[str] = None
    visitor_id: Optional[str] = None

class IdentifyOut(BaseModel):
    visitor_id: str
    level: str = "guest"

class RegisterIn(BaseModel):
    name: str
    email: str
    password: str
    visitor_id: Optional[str] = None

class LoginIn(BaseModel):
    email: str
    password: str
    visitor_id: Optional[str] = None

class ResetIn(BaseModel):
    email: str

class UserOut(BaseModel):
    user_id: str
    level: str = "user"
    jwt: Optional[str] = None
    visitor: Optional[IdentifyOut] = None

class OkOut(BaseModel):
    ok: bool = True

# --- Helpers ---
def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def _check_password(pw: str, hash_str: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hash_str.encode("utf-8"))
    except Exception:
        return False

def _client_ip(req: Request) -> str:
    # учитываем прокси
    xff = req.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else "0.0.0.0"

def _gen_dev_jwt(user_id: str, email: str) -> str:
    # Простой DEV-JWT (НЕ для продакшена). Для интеграции фронта.
    # Формат: "svid.<user_id>.<ts>"
    return f"svid.{user_id}.{int(time.time())}"

def _get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    res = sb.table("USER").select("*").eq("email", email).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None

def _get_auth_row(user_id: str) -> Optional[Dict[str, Any]]:
    res = sb.table("AUTH_VAULT").select("*").eq("user_id", user_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None

def _get_visitor(visitor_id: str) -> Optional[Dict[str, Any]]:
    res = sb.table("VISITOR").select("*").eq("id", visitor_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None

def _create_visitor(fingerprint: Optional[str], tz: Optional[str], ip: str) -> str:
    vid = str(uuid.uuid4())
    sb.table("VISITOR").insert({
        "id": vid,
        "fingerprint": fingerprint or None,
        "tz": tz or None,
        "ip": ip
    }).execute()
    return vid

def _link_visitor_to_user(visitor_id: Optional[str], user_id: str):
    if not visitor_id:
        return
    try:
        sb.table("VISITOR").update({"user_id": user_id}).eq("id", visitor_id).execute()
    except Exception:
        pass

# --- Routes ---

@router.post("/identify", response_model=IdentifyOut)
def identify(body: IdentifyIn, request: Request):
    """Шаг 1. Идентификация визитора. Если visitor_id дан — возвращаем его, иначе создаём."""
    ip = _client_ip(request)
    level = "guest"

    if body.visitor_id:
        row = _get_visitor(body.visitor_id)
        if row:
            return IdentifyOut(visitor_id=row["id"], level=row.get("level") or level)
        # если прислали несуществующий — создадим нового
    new_id = _create_visitor(body.fingerprint, body.tz, ip)
    return IdentifyOut(visitor_id=new_id, level=level)

@router.post("/register", response_model=UserOut)
def register(body: RegisterIn, request: Request):
    """Шаг 2a. Регистрация: создаём USER + AUTH_VAULT, линкуем VISITOR -> USER."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail="Invalid email")

    # уже существует?
    existed = _get_user_by_email(email)
    if existed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Email already registered")

    # создаём пользователя
    user_id = str(uuid.uuid4())
    sb.table("USER").insert({
        "id": user_id,
        "email": email,
        "name": body.name.strip(),
        "level": "user"
    }).execute()

    # кладём хэш пароля
    pw_hash = _hash_password(body.password)
    sb.table("AUTH_VAULT").insert({
        "user_id": user_id,
        "password_hash": pw_hash
    }).execute()

    # линкуем визитора (если прислан)
    _link_visitor_to_user(body.visitor_id, user_id)

    # dev jwt для фронта (опц.)
    jwt = _gen_dev_jwt(user_id, email)

    visitor_out = None
    if body.visitor_id:
        visitor_out = IdentifyOut(visitor_id=body.visitor_id, level="guest")

    return UserOut(user_id=user_id, level="user", jwt=jwt, visitor=visitor_out)

@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request):
    """Шаг 2б. Вход: проверяем email+пароль."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail="Invalid email")

    user = _get_user_by_email(email)
    if not user:
        raise HTTPException(http.HTTP_401_UNAUTHORIZED, detail="User not found")

    auth = _get_auth_row(user_id=user["id"])
    if not auth or not _check_password(body.password, auth["password_hash"]):
        raise HTTPException(http.HTTP_401_UNAUTHORIZED, detail="Wrong credentials")

    _link_visitor_to_user(body.visitor_id, user["id"])

    jwt = _gen_dev_jwt(user["id"], email)
    visitor_out = None
    if body.visitor_id:
        visitor_out = IdentifyOut(visitor_id=body.visitor_id, level="guest")

    return UserOut(user_id=user["id"], level=user.get("level") or "user", jwt=jwt, visitor=visitor_out)

@router.post("/reset")
def reset_password(body: ResetIn):
    """Шаг 2в. Сброс пароля.
       DEV-режим: генерим пароль и возвращаем его в ответе.
       PROD-режим (когда подключим email): будем слать на почту и 200 без пароля.
    """
    email = body.email.strip().lower()
    user = _get_user_by_email(email)
    if not user:
        raise HTTPException(http.HTTP_404_NOT_FOUND, detail="User not found")

    # генерим простой пароль
    new_password = _gen_dev_password(10)
    new_hash = _hash_password(new_password)

    # апдейт vault
    sb.table("AUTH_VAULT").upsert({
        "user_id": user["id"],
        "password_hash": new_hash
    }, on_conflict="user_id").execute()

    # DEV: показываем пароль прямо в ответе
    return JSONResponse({"new_password": new_password})

def _gen_dev_password(length: int = 10) -> str:
    import random, string
    pool = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^*"
    return "".join(random.choice(pool) for _ in range(length))

@router.post("/logout", response_model=OkOut)
def logout():
    """Шаг 4. Выход. Если были серверные сессии — чистили бы их здесь."""
    return OkOut(ok=True)

# (опционально) health
@router.get("/health")
def health():
    return {"ok": True, "service": "svid"}
