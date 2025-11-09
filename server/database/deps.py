# server/database/deps.py
import os
from fastapi import Header, HTTPException
import httpx

DEV_BYPASS_AUTH = os.environ.get("DEV_BYPASS_AUTH", "false").lower() in ("1", "true", "yes")
DEV_USER_ID = os.environ.get("DEV_USER_ID", "00000000-0000-0000-0000-000000000000")
DEV_EMAIL = os.environ.get("DEV_EMAIL", "dev@local")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_PUBLIC_KEY")

async def fetch_user_from_token(token: str):
    """Запрос к Supabase Auth (/auth/v1/user) — безопасно получаем user_id/email из токена."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(503, "Supabase auth not configured (URL/ANON KEY)")

    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
    }
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(url, headers=headers)
    if r.status_code != 200:
        raise HTTPException(401, f"Invalid token: {r.text}")
    data = r.json()  # {'id': ..., 'email': ...}
    return {"id": data.get("id"), "email": data.get("email")}

async def get_user_context(authorization: str = Header(default="")) -> dict:
    if DEV_BYPASS_AUTH:
        return {"id": DEV_USER_ID, "email": DEV_EMAIL, "has_token": False}

    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(401, "Missing Bearer token")

    # достоверно получаем пользователя у Supabase Auth
    user = await fetch_user_from_token(token)
    return {"id": user["id"], "email": user["email"], "has_token": True, "token": token}
