# server/svid/svid.py
from __future__ import annotations

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, Tuple
from datetime import datetime, timezone
import os
import uuid
import hashlib
import hmac
import secrets

# --- Optional (чтобы красиво ловить PostgREST детали) ---
try:
    from postgrest.exceptions import APIError as PgAPIError  # type: ignore
except Exception:
    class PgAPIError(Exception):  # fallback
        def __init__(self, message="DB error"):
            super().__init__(message)
            self.message = message

# --- Supabase client ---
try:
    from supabase import create_client, Client  # type: ignore
except Exception:
    create_client = None
    Client = None

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY", "")).strip()
_SB_ERR = None if (SUPABASE_URL and SUPABASE_KEY) else "Supabase credentials not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)"

T_USERS = "users"
T_VISITOR = "visitor"
T_VAULT = "auth_vault"

# --- Router ---
router = APIRouter(prefix="/api/svid", tags=["svid"])

# =========================
# Helpers
# =========================

def _sb() -> Client:
    if _SB_ERR:
        raise HTTPException(500, detail=_SB_ERR)
    if create_client is None:
        raise HTTPException(500, detail="Supabase client is not available")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def _hash_password(password: str) -> Dict[str, Any]:
    # простой, но достаточный для dev: PBKDF2-HMAC-SHA256
    salt = secrets.token_bytes(16)
    iters = 120_000
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return {
        "hash": {
            "algo": "pbkdf2-sha256",
            "salt": salt.hex(),
            "iters": iters,
            "hash": dk.hex(),
        }
    }

def _verify_password(password: str, spec: Dict[str, Any]) -> bool:
    try:
        h = spec["hash"]
        iters = int(h["iters"])
        salt = bytes.fromhex(h["salt"])
        expected = bytes.fromhex(h["hash"])
    except Exception:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return hmac.compare_digest(dk, expected)

def _make_dev_jwt(user_id: str) -> str:
    ts = int(datetime.now(tz=timezone.utc).timestamp())
    return f"svid.{user_id}.{ts}"

def _extract_user_id_from_dev_jwt(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "svid":
        return None
    return parts[1] or None

def _safe_execute(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except PgAPIError as e:
        raise HTTPException(400, detail=getattr(e, "message", "DB error"))
    except Exception as e:
        raise HTTPException(400, detail=str(e))

def _normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    if "@" not in email:
        raise HTTPException(400, detail="Invalid email")
    return email

# --- DB helpers ---

def _get_user_by_email(sb: Client, email: str) -> Optional[Dict[str, Any]]:
    r = _safe_execute(sb.table(T_USERS).select("*").eq("email", email).limit(1).execute)
    data = (r.data or []) if hasattr(r, "data") else (r or [])
    return data[0] if data else None

def _get_user_by_id(sb: Client, user_id: str) -> Optional[Dict[str, Any]]:
    r = _safe_execute(sb.table(T_USERS).select("*").eq("user_id", user_id).limit(1).execute)
    data = (r.data or []) if hasattr(r, "data") else (r or [])
    return data[0] if data else None

def _store_password_hash(sb: Client, user_id: str, spec: Dict[str, Any]) -> None:
    _safe_execute(sb.table(T_VAULT).insert({
        "artifact_id": str(uuid.uuid4()),
        "user_id": user_id,
        "payload": spec,
    }).execute)

def _get_password_hash_spec(sb: Client, user_id: str) -> Optional[Dict[str, Any]]:
    r = _safe_execute(sb.table(T_VAULT).select("*").eq("user_id", user_id).order("created_at", desc=True).limit(1).execute)
    data = (r.data or []) if hasattr(r, "data") else (r or [])
    return (data[0] or {}).get("payload") if data else None

def _ensure_visitor(sb: Client, visitor_id: Optional[str], tz: Optional[str]) -> Tuple[str, int]:
    # Возвращает (visitor_id, level=1). Если visitor_id не существует — создаёт.
    if visitor_id:
        # убедимся, что запись есть; если нет — создадим
        r = _safe_execute(sb.table(T_VISITOR).select("*").eq("visitor_id", visitor_id).limit(1).execute)
        data = (r.data or []) if hasattr(r, "data") else (r or [])
        if data:
            return visitor_id, int(data[0].get("level") or 1)
    vid = str(uuid.uuid4())
    _safe_execute(sb.table(T_VISITOR).insert({
        "visitor_id": vid,
        "level": 1,
        "timezone_guess": tz,
    }).execute)
    return vid, 1

# =========================
# Schemas
# =========================

class IdentifyIn(BaseModel):
    visitor_id: Optional[str] = None
    tz: Optional[str] = None
    fingerprint: Optional[Dict[str, Any]] = None

class IdentifyOut(BaseModel):
    ok: bool = True
    visitor_id: str
    level: int = 1

class RegisterIn(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = Field(None, alias="name")
    visitor_id: Optional[str] = None

class LoginIn(BaseModel):
    email: str
    password: str

class ResetIn(BaseModel):
    email: str
    password: Optional[str] = None  # dev-режим: можно не передавать → сгенерим

class UserOut(BaseModel):
    ok: bool = True
    user_id: str
    jwt: Optional[str] = None
    user: Dict[str, Any]
    visitor: Optional[Dict[str, Any]] = None

class MeOut(BaseModel):
    ok: bool = True
    user_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    level: int = 2

class OkOut(BaseModel):
    ok: bool = True

# =========================
# Routes
# =========================

@router.post("/identify", response_model=IdentifyOut)
def identify(body: IdentifyIn):
    sb = _sb()
    visitor_id, level = _ensure_visitor(sb, body.visitor_id, body.tz)
    return IdentifyOut(visitor_id=visitor_id, level=level)

@router.post("/register", response_model=UserOut)
def register(body: RegisterIn):
    sb = _sb()
    email = _normalize_email(body.email)
    if _get_user_by_email(sb, email):
        raise HTTPException(409, detail="User already exists")

    user_id = str(uuid.uuid4())
    display_name = (body.display_name or email.split("@",1)[0]).strip()

    # insert user
    _safe_execute(sb.table(T_USERS).insert({
        "user_id": user_id,
        "email": email,
        "display_name": display_name,
        "level": 2,
        "email_verified": False,
        "phone_verified": False,
    }).execute)

    # store password hash
    _store_password_hash(sb, user_id, _hash_password(body.password))

    # ensure visitor, link (опционально, если столбец есть)
    visitor_id, vlevel = _ensure_visitor(sb, body.visitor_id, None)
    try:
        _safe_execute(sb.table(T_VISITOR).update({"user_id": user_id}).eq("visitor_id", visitor_id).execute)
    except Exception:
        pass  # если колонки нет — просто пропустим

    jwt = _make_dev_jwt(user_id)
    return UserOut(
        user_id=user_id,
        jwt=jwt,
        user={"email": email, "display_name": display_name, "level": 2},
        visitor={"visitor_id": visitor_id, "level": vlevel},
    )

@router.post("/login", response_model=UserOut)
def login(body: LoginIn):
    sb = _sb()
    email = _normalize_email(body.email)
    user = _get_user_by_email(sb, email)
    if not user:
        raise HTTPException(401, detail="Invalid credentials")

    spec = _get_password_hash_spec(sb, user["user_id"])
    if not spec or not _verify_password(body.password, spec):
        raise HTTPException(401, detail="Invalid credentials")

    jwt = _make_dev_jwt(user["user_id"])
    return UserOut(
        user_id=str(user["user_id"]),
        jwt=jwt,
        user={"email": user["email"], "display_name": user.get("display_name"), "level": int(user.get("level") or 2)}
    )

@router.post("/reset", response_model=OkOut)
def reset(body: ResetIn):
    sb = _sb()
    email = _normalize_email(body.email)
    user = _get_user_by_email(sb, email)
    if not user:
        # Чтобы не раскрывать наличие email — ok
        return OkOut(ok=True)

    if body.password:
        new_spec = _hash_password(body.password)
        _store_password_hash(sb, user["user_id"], new_spec)
        return OkOut(ok=True)

    # dev-режим: если пароль не прислали — сгенерим и вернём (можно включить ответ клиенту, если нужно)
    new_password = secrets.token_urlsafe(10)
    new_spec = _hash_password(new_password)
    _store_password_hash(sb, user["user_id"], new_spec)
    # В dev можно вернуть new_password, но по умолчанию оставим ok=True, чтобы фронт не зависел.
    return OkOut(ok=True)

@router.get("/me", response_model=MeOut)
def me(request: Request):
    user_id = _extract_user_id_from_dev_jwt(request.headers.get("Authorization"))
    if not user_id:
        raise HTTPException(401, detail="No or invalid dev token")

    sb = _sb()
    user = _get_user_by_id(sb, user_id)
    if not user:
        raise HTTPException(404, detail="User not found")
    return MeOut(
        user_id=str(user["user_id"]),
        display_name=user.get("display_name"),
        email=user.get("email"),
        level=int(user.get("level") or 2),
    )

@router.post("/logout", response_model=OkOut)
def logout():
    # dev: серверных сессий нет — просто говорим ок; фронт чистит localStorage
    return OkOut(ok=True)

@router.get("/health")
def health():
    return {"ok": True, "ts": int(datetime.now(tz=timezone.utc).timestamp())}

# =========================
# Error handlers (detail всегда есть)
# =========================

app = FastAPI()
app.include_router(router)

@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "detail": exc.detail})

from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(StarletteHTTPException)
async def starlette_exc_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "detail": exc.detail})

@app.exception_handler(RequestValidationError)
async def val_exc_handler(request: Request, exc: RequestValidationError):
    msg = "; ".join([e.get("msg", "validation error") for e in exc.errors()]) or "Invalid payload"
    return JSONResponse(status_code=422, content={"ok": False, "detail": msg})
