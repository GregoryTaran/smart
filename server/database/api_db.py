# server/database/api_db.py
from fastapi import APIRouter, Header, HTTPException
from starlette.responses import JSONResponse
from .supabase_client import get_clients

router = APIRouter()
public, admin = get_clients()

def _require_supabase():
    if not admin:
        raise HTTPException(503, "Supabase not configured on server")

@router.get("/whoami")
def whoami(authorization: str = Header(default="")):
    _require_supabase()
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(401, "Missing Bearer token")
    user = admin.auth.get_user(token)  # проверка JWT через Supabase
    return JSONResponse({"user_id": user.user.id, "email": user.user.email})

@router.get("/profiles/me")
def get_my_profile(authorization: str = Header(default="")):
    _require_supabase()
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(401, "Missing Bearer token")
    user = admin.auth.get_user(token)
    res = admin.table("profiles").select("*").eq("id", user.user.id).single().execute()
    return res.data or {}
