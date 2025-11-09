# server/database/api_records.py
from fastapi import APIRouter, Depends, HTTPException
from .supabase_client import get_clients
from .deps import get_user_context

router = APIRouter()
public, admin = get_clients()

def _require_admin():
    if not admin:
        raise HTTPException(503, "Supabase not configured on server")

@router.get("/records")
def list_records(user = Depends(get_user_context)):
    _require_admin()
    # фильтруем по владельцу, если есть user_id (в dev-режиме он фиктивный)
    q = admin.table("records").select("*").order("created_at", desc=True)
    if user.get("id"):
        q = q.eq("owner_id", user["id"])
    res = q.limit(50).execute()
    return res.data or []

@router.post("/records")
def create_record(payload: dict, user = Depends(get_user_context)):
    _require_admin()
    data = {
        "title": payload.get("title") or "Untitled",
        "meta": payload.get("meta") or {},
    }
    # если есть user_id — проставим владельца
    if user.get("id"):
        data["owner_id"] = user["id"]
    res = admin.table("records").insert(data).execute()
    return res.data or {}
