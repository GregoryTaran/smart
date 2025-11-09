# server/database/api_records.py
from fastapi import APIRouter, Depends, HTTPException
from .supabase_client import get_clients
from .deps import get_user_context

router = APIRouter()
public, admin = get_clients()

def _require_admin():
    if not admin:
        raise HTTPException(503, "Supabase not configured on server (service role)")

@router.get("/records")
async def list_records(user = Depends(get_user_context)):
    _require_admin()
    try:
        q = admin.table("records").select("*").order("created_at", desc=True)
        if user.get("id"):
            q = q.eq("owner_id", user["id"])
        res = q.limit(50).execute()
        if getattr(res, "error", None):
            raise HTTPException(502, f"Supabase error: {res.error}")
        return res.data or []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"records/list failed: {e}")

@router.post("/records")
async def create_record(payload: dict, user = Depends(get_user_context)):
    _require_admin()
    try:
        data = {
            "title": payload.get("title") or "Untitled",
            "meta": payload.get("meta") or {},
        }
        if user.get("id"):
            data["owner_id"] = user["id"]
        res = admin.table("records").insert(data).execute()
        if getattr(res, "error", None):
            raise HTTPException(502, f"Supabase error: {res.error}")
        return res.data or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"records/create failed: {e}")
