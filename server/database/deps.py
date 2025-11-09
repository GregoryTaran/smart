# server/database/deps.py
import os
from fastapi import Header, HTTPException

DEV_BYPASS_AUTH = os.environ.get("DEV_BYPASS_AUTH", "false").lower() in ("1", "true", "yes")
DEV_USER_ID = os.environ.get("DEV_USER_ID", "00000000-0000-0000-0000-000000000000")
DEV_EMAIL = os.environ.get("DEV_EMAIL", "dev@local")

def get_user_context(authorization: str = Header(default="")) -> dict:
    """
    В dev-режиме возвращает фиктивного пользователя.
    В prod — ждёт Bearer токен (пока можно не использовать).
    """
    if DEV_BYPASS_AUTH:
        return {"id": DEV_USER_ID, "email": DEV_EMAIL, "has_token": False}

    token = authorization.replace("Bearer ", "").strip()
    if not token:
        # Можно вернуть 401, но пока оставим мягко — вдруг будем дергать /health и простые ручки
        raise HTTPException(401, "Missing Bearer token")
    return {"token": token, "has_token": True}
