# server/svid/svid.py — стабильная версия с фиксом под Supabase v2.x
from __future__ import annotations
import os, uuid, hashlib, hmac, secrets
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple
from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator

# ---------- Supabase ----------
try:
    from supabase import create_client, Client  # type: ignore
except Exception:
    create_client = None
    Client = None

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY", "")).strip()
_SB_ERR = None if (SUPABASE_URL and SUPABASE_KEY) else "Supabase credentials not configured (SUPABASE_URL / SERVICE_KEY)"

T_USERS = "users"
T_VISITOR = "visitor"
T_VAULT = "auth_vault"

app = FastAPI()
router = APIRouter(prefix="/api/svid", tags=["svid"])

# ---------- Helpers ----------
def _sb() -> Client:
    if _SB_ERR:
        raise HTTPException(500, detail=_SB_ERR)
    if create_client is None:
        raise HTTPException(500, detail="Supabase client library not available")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def _normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, detail="Invalid email")
    return email

def _extract_data(r) -> list:
    """Универсальный извлекатель данных из supabase-пакета."""
    if r is None:
        return []
    if isinstance(r, list):
        return r
    if hasattr(r, "data") and isinstance(r.data, list):
        return r.data
    if hasattr(r, "json") and isinstance(r.json, dict) and "data" in r.json:
        return r.json["data"]
    if isinstance(r, dict) and "data" in r:
        return r["data"]
    return []

def _hash_password(password: str) -> Dict[str, Any]:
    if not password or len(password) < 6:
        raise HTTPException(400, detail="Password must be at least 6 characters")
    salt = secrets.token_bytes(16)
    iters = 120_000
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return {"hash": {"algo": "pbkdf2_sha256", "salt": salt.hex(), "iters": iters, "hash": dk.hex()}}

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

def _safe_execute(call):
    try:
        return call()
    except Exception as e:
        raise HTTPException(400, detail=f"DB error: {e}")

def _get_user_by_email(sb: Client, email: str) -> Optional[Dict[str, Any]]:
    r = _safe_execute(sb.table(T_USERS).select("*").eq("email", email).limit(1).execute)
    data = _extract_data(r)
    return data[0] if data else None

def _get_user_by_id(sb: Client, user_id: str) -> Optional[Dict[str, Any]]:
    r = _safe_execute(sb.table(T_USERS).select("*").eq("user_id", user_id).limit(1).execute)
    data = _extract_data(r)
    return data[0] if data else None

def _store_password_hash(sb: Client, user_id: str, spec: Dict[str, Any]) -> None:
    _safe_execute(sb.table(T_VAULT).insert({
        "artifact_id": str(uuid.uuid4()),
        "user_id": user_id,
        "provider": "email",
        "kind": "password_hash",
        "status": "active",
        "payload": spec,
    }).execute)

def _get_password_hash_spec(sb: Client, user_id: str) -> Optional[Dict[str, Any]]:
    r = _safe_execute(sb.table(T_VAULT)
                      .select("payload")
                      .eq("user_id", user_id)
                      .eq("kind", "password_hash")
                      .order("created_at", desc=True)
                      .limit(1)
                      .execute)
    data = _extract_data(r)
    return (data[0] or {}).get("payload") if data else None

def _ensure_visitor(sb: Client, visitor_id: Optional[str], tz: Optional[str]) -> Tuple[str, int]:
    if visitor_id:
        r = _safe_execute(sb.table(T_VISITOR).select("*").eq("visitor_id", visitor_id).limit(1).execute)
        data = _extract_data(r)
        if data:
            lvl = int(data[0].get("level") or 1)
            return visitor_id, lvl
    vid = str(uuid.uuid4())
    _safe_execute(sb.table(T_VISITOR).insert({"visitor_id": vid, "level": 1, "timezone_guess": tz}).execute)
    return vid, 1

def _make_dev_jwt(user_id: str) -> str:
    ts = int(datetime.now(tz=timezone.utc).timestamp())
    return f"svid.{user_id}.{ts}"

def _extract_user_id_from_dev_jwt(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "svid":
        return None
    return parts[1] or None

# ---------- Schemas ----------
class IdentifyIn(BaseModel):
    visitor_id: Optional[str] = None
    tz: Optional[str] = None

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
    password: Optional[str] = None

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
    new_password: Optional[str] = None

# ---------- Routes ----------
@router.get("/health")
def health():
    return {"ok": True, "ts": int(datetime.now(tz=timezone.utc).timestamp())}

@router.post("/identify", response_model=IdentifyOut)
def identify(body: IdentifyIn):
    sb = _sb()
    visitor_id, level = _ensure_visitor(sb, body.visitor_id, body.tz)
    return IdentifyOut(visitor_id=visitor_id, level=level)

@router.post("/register", response_model=UserOut)
def register(body: RegisterIn):
    sb = _sb()
    email = _normalize_email(body.email)
    display_name = (body.display_name or email.split("@", 1)[0]).strip()
    if _get_user_by_email(sb, email):
        raise HTTPException(409, detail="User already exists")

    user_id = str(uuid.uuid4())
    _safe_execute(sb.table(T_USERS).insert({
        "user_id": user_id,
        "email": email,
        "display_name": display_name,
        "level": 2,
        "email_verified": False,
        "phone_verified": False,
    }).execute)

    _store_password_hash(sb, user_id, _hash_password(body.password))
    visitor_id, vlevel = _ensure_visitor(sb, body.visitor_id, None)
    try:
        _safe_execute(sb.table(T_VISITOR).update({
            "user_id": user_id, "linked_to_user": True,
            "linked_at": datetime.now(timezone.utc)
        }).eq("visitor_id", visitor_id).execute)
    except Exception:
        pass

    jwt = _make_dev_jwt(user_id)
    return UserOut(
        user_id=user_id, jwt=jwt,
        user={"email": email, "display_name": display_name, "level": 2},
        visitor={"visitor_id": visitor_id, "level": vlevel}
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
        return OkOut(ok=True)

    if body.password and body.password.strip():
        _store_password_hash(sb, user["user_id"], _hash_password(body.password.strip()))
        return OkOut(ok=True)

    rnd = secrets.token_urlsafe(10)
    _store_password_hash(sb, user["user_id"], _hash_password(rnd))
    return OkOut(ok=True, new_password=rnd)

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
    return OkOut(ok=True)

# ---------- Error handlers ----------
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "detail": exc.detail})

@app.exception_handler(StarletteHTTPException)
async def starlette_exc_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "detail": exc.detail})

@app.exception_handler(RequestValidationError)
async def val_exc_handler(request: Request, exc: RequestValidationError):
    msg = "; ".join([e.get("msg", "validation error") for e in exc.errors()]) or "Invalid payload"
    return JSONResponse(status_code=422, content={"ok": False, "detail": msg})

app.include_router(router)
