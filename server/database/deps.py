# server/database/deps.py

import os
from fastapi import Header, HTTPException
import httpx

DEV_BYPASS_AUTH = os.environ.get("DEV_BYPASS_AUTH", "false").lower() in ("1", "true", "yes")
DEV_USER_ID = os.environ.get("DEV_USER_ID", "00000000-0000-0000-0000-000000000000")
DEV_EMAIL = os.environ.get("DEV_EMAIL", "dev@local")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_PUBLIC_KEY")

def _parse_svid_token(token: str) -> str | None:
    """
    Наш DEV-токен от SVID: 'svid.<user_id>.<ts>'.
    Возвращает user_id или None.
    """
    try:
        prefix, user_id, _ = token.split(".", 2)
        if prefix != "svid":
            return None
        # На вкус: можно добавить лёгкую проверку формата UUID
        return user_id
    except ValueError:
        return None

async def fetch_user_from_token(token: str):
    """Supabase Auth: достаём user (id/email) по реальному Supabase-JWT."""
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
    data = r.json()
    return {"id": data.get("id"), "email": data.get("email")}

async def get_user_context(authorization: str = Header(default="")) -> dict:
    """
    Единая точка:
    - DEV_BYPASS_AUTH=true -> фиктивный пользователь из ENV
    - Если Bearer начинается с 'svid.' -> принять наш DEV-токен и вернуть контекст
    - Иначе -> нормальная проверка токена через Supabase Auth
    """
    if DEV_BYPASS_AUTH:
        return {"id": DEV_USER_ID, "email": DEV_EMAIL, "has_token": False, "source": "dev_bypass"}

    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(401, "Missing Bearer token")

    # 1) Наш DEV-токен от SVID
    user_id = _parse_svid_token(token)
    if user_id:
        # (опционально) Проверим, что такой USER существует у нас в БД:
        try:
            # локальный импорт, чтобы не плодить зависимостей на модульный уровень
            from .supabase_client import get_clients
            _pub, admin = get_clients()
            if admin:
                res = admin.table("USER").select("id, email").eq("id", user_id).limit(1).execute()
                rows = res.data or []
                email = rows[0]["email"] if rows else None
            else:
                email = None
        except Exception:
            email = None

        return {"id": user_id, "email": email, "has_token": True, "token": token, "source": "svid_dev"}

    # 2) Иначе — реальный Supabase-токен
    user = await fetch_user_from_token(token)
    return {"id": user["id"], "email": user["email"], "has_token": True, "token": token, "source": "supabase"}
