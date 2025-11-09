# server/database/supabase_client.py
import os
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def get_clients() -> tuple[Client | None, Client | None]:
    """(public_client, admin_client) — вернёт None, если переменных нет"""
    if not SUPABASE_URL:
        return (None, None)
    public = create_client(SUPABASE_URL, ANON_KEY) if ANON_KEY else None
    admin = create_client(SUPABASE_URL, SERVICE_ROLE_KEY) if SERVICE_ROLE_KEY else None
    return (public, admin)
