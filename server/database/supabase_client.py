# server/database/supabase_client.py
import os
from supabase import create_client, Client

_SUPABASE_URL = os.environ.get("SUPABASE_URL")
_SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_PUBLIC_KEY")
_SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

_public: Client | None = None
_admin: Client | None = None

def get_clients():
    global _public, _admin
    if _SUPABASE_URL and _SUPABASE_ANON_KEY and _public is None:
        _public = create_client(_SUPABASE_URL, _SUPABASE_ANON_KEY)
    if _SUPABASE_URL and _SUPABASE_SERVICE_ROLE_KEY and _admin is None:
        _admin = create_client(_SUPABASE_URL, _SUPABASE_SERVICE_ROLE_KEY)
    return _public, _admin
