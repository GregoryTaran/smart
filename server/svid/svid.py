# server/svid/svid.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import os
import hashlib
import hmac
import secrets
import uuid

# --- Supabase client (supabase-py v2) ---------------------------------------
try:
    from supabase import create_client, Client  # type: ignore
except Exception:  # pragma: no cover
    create_client = None
    Client = None

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY", os.getenv("SUPABASE_SERVICE_KEY", "")).strip()
_SB_ERR = None if (SUPABASE_URL and SUPABASE_KEY) else "Supabase credentials are not configured (SUPABASE_URL / SUPABASE_ANON_KEY)."

def _sb() -> Client:
    if _SB_ERR:
        raise HTTPException(500, detail=_SB_ERR)
    if create_client is None:
        raise HTTPException(500, detail="supabase client is not installed on server.")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Tables ------------------------------------------------------------------
T_VISITOR = "visitor"
T_USERS   = "users"
T_VAULT   = "auth_vault"

# --- Router ------------------------------------------------------------------
router = APIRouter(prefix="/api/svid", tags=["svid"])

# --- PBKDF2 ------------------------------------------------------------------
class HashSpec(BaseModel):
    algo: str = "pbkdf2_sha256"
    salt: str
    iters: int = 120_000
    hash: str

def _pbkdf2(password: str, salt: bytes, iters: int = 120_000) -> bytes:
    import hashlib as _hl
    return _hl.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters, dklen=32)

def _hash_password(password: str, iters: int = 120_000) -> HashSpec:
    salt = secrets.token_bytes(16)
    digest = _pbkdf2(password, salt, iters)
    return HashSpec(salt=salt.hex(), iters=iters, hash=digest.hex())

def _verify_password(password: str, spec: HashSpec) -> bool:
    if spec.algo != "pbkdf2_sha256":
        return False
    salt = bytes.fromhex(spec.salt)
    need = bytes.fromhex(spec.hash)
    got = _pbkdf2(password, salt, spec.iters)
    return hmac.compare_digest(got, need)

# --- Dev JWT -----------------------------------------------------------------
def _dev_jwt(user_id: str) -> str:
    return f"svid.{user_id}.{int(datetime.now(tz=timezone.utc).timestamp())}"

def _extract_user_id_from_dev_jwt(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    try:
        if not auth_header.startswith("Bearer "):
            return None
        token = auth_header.split(" ", 1)[1].strip()
        p = token.split(".")
        if len(p) < 3 or p[0] != "svid":
            return None
        return p[1]
    except Exception:
        return None

# --- Schemas -----------------------------------------------------------------
class IdentifyIn(BaseModel):
    fingerprint: Optional[str] = None  # клиентский идентификатор (опц.)
    tz: Optional[str] = None           # например "Europe/Dublin"
    visitor_id: Optional[str] = None   # если уже есть

class IdentifyOut(BaseModel):
    visitor_id: str
    level: int = 1

class RegisterIn(BaseModel):
    name: Optional[str] = Field(None, alias="display_name")
    display_name: Optional[str] = None
    email: str
    password: str
    visitor_id: Optional[str] = None

class UserOut(BaseModel):
    user_id: str
    level: int = 2
    jwt: Optional[str] = None
    visitor: Optional[IdentifyOut] = None

class LoginIn(BaseModel):
    email: str
    password: str
    visitor_id: Optional[str] = None

class ResetIn(BaseModel):
    email: str
    password: str

class OkOut(BaseModel):
    ok: bool = True

class MeOut(BaseModel):
    user_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    level: int = 2

# --- Helpers -----------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()

def _client_ip(request: Request) -> Optional[str]:
    try:
        # Render/Proxies могут присылать X-Forwarded-For; при желании можно его разобрать
        return request.client.host if request and request.client else None
    except Exception:
        return None

def _ensure_visitor(sb: Client, body: IdentifyIn) -> str:
    """
    Создаём visitor при отсутствии. Пишем только существующие поля по твоей схеме:
      - visitor_id (UUID, наш)
      - level = 1 (если хочешь — можно не слать, у тебя дефолт 1)
      - first_seen_at (ts)
      - timezone_guess (из tz)
    Остальные поля (utm, девайс и т.п.) добавим позже, когда решим собирать.
    """
    if body.visitor_id:
        return body.visitor_id

    vid = str(uuid.uuid4())
    payload: Dict[str, Any] = {
        "visitor_id": vid,
        "level": 1,
        "first_seen_at": _now_iso(),
    }
    if body.tz:
        payload["timezone_guess"] = body.tz

    sb.table(T_VISITOR).insert(payload).execute()
    return vid

def _link_visitor_to_user(sb: Client, visitor_id: Optional[str], user_id: str) -> None:
    """
    Если есть visitor_id — линкуем к пользователю: linked_to_user, user_id, linked_at.
    """
    if not visitor_id:
        return
    try:
        sb.table(T_VISITOR).update({
            "linked_to_user": True,
            "user_id": user_id,
            "linked_at": _now_iso(),
        }).eq("visitor_id", visitor_id).execute()
    except Exception:
        # не валим поток — линковка вторична
        pass

def _get_user_by_email(sb: Client, email: str) -> Optional[Dict[str, Any]]:
    q = sb.table(T_USERS).select("*").eq("email", email).limit(1).execute()
    rows = q.data or []
    return rows[0] if rows else None

def _get_user_by_id(sb: Client, user_id: str) -> Optional[Dict[str, Any]]:
    q = sb.table(T_USERS).select("*").eq("user_id", user_id).limit(1).execute()
    rows = q.data or []
    return rows[0] if rows else None

def _store_password_hash(sb: Client, user_id: str, spec: HashSpec) -> None:
    # у auth_vault в твоей схеме created_at есть — оставляем
    sb.table(T_VAULT).insert({
        "user_id": user_id,
        "payload": {"hash": spec.model_dump()},
        "created_at": _now_iso(),
    }).execute()

def _get_password_hash(sb: Client, user_id: str) -> Optional[HashSpec]:
    q = sb.table(T_VAULT).select("payload").eq("user_id", user_id).order("created_at", desc=True).limit(1).execute()
    rows = q.data or []
    if not rows:
        return None
    payload = rows[0].get("payload") or {}
    spec = payload.get("hash")
    if not spec:
        return None
    try:
        return HashSpec(**spec)
    except Exception:
        return None

# --- Routes ------------------------------------------------------------------
@router.post("/identify", response_model=IdentifyOut)
def identify(body: IdentifyIn):
    sb = _sb()
    vid = _ensure_visitor(sb, body)
    return IdentifyOut(visitor_id=vid, level=1)

@router.post("/register", response_model=UserOut)
def register(body: RegisterIn, request: Request):
    sb = _sb()

    display_name = body.display_name or body.name
    if _get_user_by_email(sb, body.email):
        raise HTTPException(409, detail="User already exists")

    user_id = str(uuid.uuid4())
    # users: по твоей схеме точно есть created_at, level (default 2), email, display_name
    sb.table(T_USERS).insert({
        "user_id": user_id,
        "display_name": display_name,
        "email": body.email,
        "level": 2,
        "created_at": _now_iso(),
        "last_login_at": _now_iso(),
        "last_ip": _client_ip(request),
        "email_verified": False,
        "phone_verified": False,
    }).execute()

    spec = _hash_password(body.password)
    _store_password_hash(sb, user_id, spec)

    # создаём/подтверждаем визитора и линкуем
    vid = _ensure_visitor(sb, IdentifyIn(visitor_id=body.visitor_id, tz=None, fingerprint=None))
    _link_visitor_to_user(sb, vid, user_id)

    return UserOut(
        user_id=user_id,
        level=2,
        jwt=_dev_jwt(user_id),
        visitor=IdentifyOut(visitor_id=vid, level=1),
    )

@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request):
    sb = _sb()
    user = _get_user_by_email(sb, body.email)
    if not user:
        raise HTTPException(401, detail="Invalid credentials")

    user_id = str(user.get("user_id") or user.get("id"))
    spec = _get_password_hash(sb, user_id)
    if not spec or not _verify_password(body.password, spec):
        raise HTTPException(401, detail="Invalid credentials")

    # апдейтим last_login_at / last_ip
    try:
        sb.table(T_USERS).update({
            "last_login_at": _now_iso(),
            "last_ip": _client_ip(request),
        }).eq("user_id", user_id).execute()
    except Exception:
        pass

    # визитор и линковка
    vid = _ensure_visitor(sb, IdentifyIn(visitor_id=body.visitor_id, tz=None, fingerprint=None))
    _link_visitor_to_user(sb, vid, user_id)

    return UserOut(
        user_id=user_id,
        level=int(user.get("level") or 2),
        jwt=_dev_jwt(user_id),
        visitor=IdentifyOut(visitor_id=vid, level=1),
    )

@router.post("/reset", response_model=OkOut)
def reset(body: ResetIn):
    sb = _sb()
    user = _get_user_by_email(sb, body.email)
    if not user:
        return OkOut(ok=True)  # не раскрываем существование email
    user_id = str(user.get("user_id") or user.get("id"))
    spec = _hash_password(body.password)
    _store_password_hash(sb, user_id, spec)
    return OkOut(ok=True)

@router.post("/logout", response_model=OkOut)
def logout():
    return OkOut(ok=True)

@router.get("/me", response_model=MeOut)
def me(request: Request):
    sb = _sb()
    user_id = _extract_user_id_from_dev_jwt(request.headers.get("authorization"))
    if not user_id:
        raise HTTPException(401, detail="Unauthorized")
    user = _get_user_by_id(sb, user_id)
    if not user:
        raise HTTPException(404, detail="User not found")
    return MeOut(
        user_id=str(user.get("user_id") or user.get("id")),
        display_name=user.get("display_name"),
        email=user.get("email"),
        level=int(user.get("level") or 2),
    )

@router.get("/health")
def health():
    return {"ok": True, "ts": int(datetime.now(tz=timezone.utc).timestamp())}
