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

@router.post("/records", status_code=201)
async def create_record(payload: dict, user = Depends(get_user_context)):
    _require_admin()
    import uuid
    try:
        new_id = str(uuid.uuid4())
        data = {
            "id": new_id,  # генерим id заранее
            "title": payload.get("title") or "Untitled",
            "meta": payload.get("meta") or {},
        }
        if user.get("id"):
            data["owner_id"] = user["id"]

        # 1) вставка
        res_ins = admin.table("records").insert(data).execute()
        if getattr(res_ins, "error", None):
            raise HTTPException(502, f"Supabase insert error: {res_ins.error}")

        # 2) дочитываем вставленную строку (одним объектом)
        res_get = admin.table("records").select("*").eq("id", new_id).limit(1).execute()
        if getattr(res_get, "error", None):
            raise HTTPException(502, f"Supabase select-after-insert error: {res_get.error}")

        rows = res_get.data or []
        return rows[0] if rows else data  # на крайний случай вернём то, что вставили
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"records/create failed: {e}")

@router.get("/records/{record_id}")
async def get_record(record_id: str, user = Depends(get_user_context)):
    _require_admin()
    try:
        q = admin.table("records").select("*").eq("id", record_id)
        if user.get("id"):
            q = q.eq("owner_id", user["id"])
        res = q.limit(1).execute()
        if getattr(res, "error", None):
            raise HTTPException(502, f"Supabase error: {res.error}")

        rows = res.data or []
        if not rows:
            raise HTTPException(404, "Record not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"records/get failed: {e}")

@router.delete("/records/{record_id}")
async def delete_record(record_id: str, user = Depends(get_user_context)):
    _require_admin()
    try:
        q = admin.table("records").delete().eq("id", record_id)
        if user.get("id"):
            q = q.eq("owner_id", user["id"])
        res = q.execute()
        if getattr(res, "error", None):
            raise HTTPException(502, f"Supabase error: {res.error}")

        rows = res.data or []
        if not rows:
            raise HTTPException(404, "Record not found or not owned by user")
        return {"deleted": True, "id": record_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"records/delete failed: {e}")
