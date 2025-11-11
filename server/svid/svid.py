# /server/svid/svid.py
# SVID API под схему: visitor(visitor_id,...), users(user_id,...), auth_vault(...)
# Пароли: PBKDF2-HMAC (sha256) на stdlib, без внешних зависимостей.

import os, time, uuid, secrets, base64, hashlib, hmac
from typing import Optional, Any, Dict
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi import status as http
from pydantic import BaseModel
from supabase import create_client, Client

# ---------- Supabase ----------
def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")
    return create_client(url, key)

sb: Client = get_supabase()
router = APIRouter(prefix="/api/svid", tags=["svid"])

# ---------- Модели ----------
class IdentifyIn(BaseModel):
    fingerprint: Optional[str] = None
    tz: Optional[str] = None
    visitor_id: Optional[str] = None
    landing_url: Optional[str] = None
    referrer_host: Optional[str] = None

class IdentifyOut(BaseModel):
    visitor_id: str
    level: int = 1  # 1 = guest (см. справочник levels)

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
    level: int = 2  # 2 = user
    jwt: Optional[str] = None
    visitor: Optional[IdentifyOut] = None

class OkOut(BaseModel):
    ok: bool = True

# ---------- Константы / таблицы ----------
T_VISITOR = "visitor"      # PK: visitor_id (uuid)
T_USERS   = "users"        # PK: user_id (uuid)
T_VAULT   = "auth_vault"   # artifact_id (uuid), user_id, provider, kind, payload JSONB

# ---------- Хэш пароля (PBKDF2-HMAC/sha256, 100k итераций) ----------
def _hash_password(pw: str) -> str:
    """Храним base64(salt||dk)."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 100_000)
    return base64.b64encode(salt + dk).decode("utf-8")

def _check_password(pw: str, stored: str) -> bool:
    try:
        raw = base64.b64decode(stored.encode("utf-8"))
        salt, dk = raw[:16], raw[16:]
        new_dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 100_000)
    except Exception:
        return False
    return hmac.compare_digest(dk, new_dk)

# ---------- Утилиты ----------
def _client_ip(req: Request) -> str:
    xff = req.headers.get("x-forwarded-for")
    return xff.split(",")[0].strip() if xff else (req.client.host if req.client else "0.0.0.0")

def _dev_jwt(user_id: str) -> str:
    # простой DEV-JWT для фронта (не для прода)
    return f"svid.{user_id}.{int(time.time())}"

# ---------- DB-хелперы (с твоими именами полей) ----------
def _get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    res = sb.table(T_USERS).select("*").eq("email", email).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None

def _get_password_hash_artifact(user_id: str) -> Optional[str]:
    # Берём последний артефакт с паролем
    res = (
        sb.table(T_VAULT)
        .select("payload")
        .eq("user_id", user_id)
        .eq("provider", "email")
        .eq("kind", "password_hash")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows: return None
    payload = rows[0].get("payload") or {}
    return payload.get("hash")

def _put_password_hash_artifact(user_id: str, hash_str: str):
    sb.table(T_VAULT).insert({
        "artifact_id": str(uuid.uuid4()),
        "user_id": user_id,
        "provider": "email",
        "kind": "password_hash",
        "payload": {
            "algo": "pbkdf2_sha256",
            "iter": 100_000,
            "hash": hash_str
        },
        "status": "active"
    }).execute()

def _get_visitor(visitor_id: str) -> Optional[Dict[str, Any]]:
    res = sb.table(T_VISITOR).select("*").eq("visitor_id", visitor_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None

def _create_visitor(data: IdentifyIn, ip: str) -> str:
    vid = str(uuid.uuid4())
    sb.table(T_VISITOR).insert({
        "visitor_id": vid,
        "level": 1,  # guest
        "first_seen_at": None,         # default now() если настроено; иначе можно убрать
        "landing_url": data.landing_url or None,
        "referrer_host": data.referrer_host or None,
        "ip_address": ip,
        "timezone_guess": data.tz or None,
        "user_agent_hash": None,       # при желании добавим
    }).execute()
    return vid

def _link_visitor_to_user(visitor_id: Optional[str], user_id: str):
    if not visitor_id: 
        return
    try:
        sb.table(T_VISITOR).update({
            "user_id": user_id,
            "linked_to_user": True,
            "linked_at": "now()"
        }).eq("visitor_id", visitor_id).execute()
    except Exception:
        pass

# ---------- Ручки ----------
@router.post("/identify", response_model=IdentifyOut)
def identify(body: IdentifyIn, request: Request):
    """Шаг 1: любой посетитель получает visitor_id и уровень=1 (guest)."""
    ip = _client_ip(request)

    # Если визитор уже есть в localStorage — вернём его (если существует в БД)
    if body.visitor_id:
        row = _get_visitor(body.visitor_id)
        if row:
            return IdentifyOut(visitor_id=row["visitor_id"], level=row.get("level") or 1)

    # Иначе создаём нового
    new_id = _create_visitor(body, ip)
    return IdentifyOut(visitor_id=new_id, level=1)

@router.post("/register", response_model=UserOut)
def register(body: RegisterIn, request: Request):
    """Шаг 2a: регистрируем пользователя, сохраняем хэш пароля в auth_vault."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail="Invalid email")

    existed = _get_user_by_email(email)
    if existed:
        raise HTTPException(http.HTTP_409_CONFLICT, detail="Email already registered")

    user_id = str(uuid.uuid4())
    try:
        # users: user_id / display_name / email / level(int2=2=user)
        sb.table(T_USERS).insert({
            "user_id": user_id,
            "display_name": body.name.strip(),
            "email": email,
            "level": 2
        }).execute()

        # пароль: как артефакт в auth_vault
        _put_password_hash_artifact(user_id, _hash_password(body.password))

        _link_visitor_to_user(body.visitor_id, user_id)
    except Exception as e:
        raise HTTPException(http.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"DB error: {e}")

    jwt = _dev_jwt(user_id)
    visitor_out = IdentifyOut(visitor_id=body.visitor_id, level=1) if body.visitor_id else None
    return UserOut(user_id=user_id, level=2, jwt=jwt, visitor=visitor_out)

@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request):
    """Шаг 2б: вход по email+паролю (проверяем артефакт с паролем)."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail="Invalid email")

    user = _get_user_by_email(email)
    if not user:
        raise HTTPException(http.HTTP_401_UNAUTHORIZED, detail="User not found")

    hash_str = _get_password_hash_artifact(user_id=user["user_id"])
    if not hash_str or not _check_password(body.password, hash_str):
        raise HTTPException(http.HTTP_401_UNAUTHORIZED, detail="Wrong credentials")

    _link_visitor_to_user(body.visitor_id, user["user_id"])

    jwt = _dev_jwt(user["user_id"])
    visitor_out = IdentifyOut(visitor_id=body.visitor_id, level=1) if body.visitor_id else None
    return UserOut(
        user_id=user["user_id"],
        level=user.get("level") or 2,
        jwt=jwt,
        visitor=visitor_out
    )

@router.post("/reset")
def reset_password(body: ResetIn):
    """Шаг 2в: dev-режим — генерим новый пароль, сохраняем как артефакт и возвращаем."""
    email = body.email.strip().lower()
    user = _get_user_by_email(email)
    if not user:
        raise HTTPException(http.HTTP_404_NOT_FOUND, detail="User not found")

    new_password = _gen_dev_password(10)
    try:
        _put_password_hash_artifact(user["user_id"], _hash_password(new_password))
    except Exception as e:
        raise HTTPException(http.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"DB error: {e}")

    return JSONResponse({"new_password": new_password})

def _gen_dev_password(length: int = 10) -> str:
    import random
    pool = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^*"
    return "".join(random.choice(pool) for _ in range(length))

@router.post("/logout", response_model=OkOut)
def logout():
    return OkOut(ok=True)

@router.get("/health")
def health():
    return {"ok": True, "service": "svid"}
