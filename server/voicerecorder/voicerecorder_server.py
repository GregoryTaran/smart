# voicerecorder_server.py
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime
import uuid

from supabase import create_client
import os

router = APIRouter()

# --- Supabase config ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

BUCKET = "sv-storage"
FOLDER = "voicerecorder"


# ===============================
# MODELS
# ===============================
class RenameRequest(BaseModel):
    user_id: str
    rec_id: str
    display_name: str


class DeleteRequest(BaseModel):
    user_id: str
    rec_id: str


# ===============================
# LIST RECORDS
# ===============================
@router.get("/list")
async def list_records(user_id: str):
    try:
        rows = supabase.table("voicerecorder_records") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .execute()

        data = rows.data if hasattr(rows, "data") else rows.get("data", [])
        return {"ok": True, "records": data}

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ===============================
# RENAME RECORD
# ===============================
@router.post("/rename")
async def rename_record(req: RenameRequest):
    try:
        supabase.table("voicerecorder_records") \
            .update({
                "display_name": req.display_name,
                "updated_at": datetime.utcnow().isoformat()
            }) \
            .eq("user_id", req.user_id) \
            .eq("rec_id", req.rec_id) \
            .execute()

        return {"ok": True}

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ===============================
# DELETE RECORD
# ===============================
@router.post("/delete")
async def delete_record(req: DeleteRequest):
    try:
        # Найти запись
        rows = supabase.table("voicerecorder_records") \
            .select("*") \
            .eq("user_id", req.user_id) \
            .eq("rec_id", req.rec_id) \
            .limit(1) \
            .execute()

        row_list = rows.data if hasattr(rows, "data") else rows.get("data", [])
        if not row_list:
            raise HTTPException(404, "Record not found")

        rec = row_list[0]
        storage_path = rec.get("storage_path")

        # Удалить файл из хранилища
        try:
            supabase.storage.from_(BUCKET).remove([storage_path])
        except:
            pass

        # Удалить строку
        supabase.table("voicerecorder_records") \
            .delete() \
            .eq("user_id", req.user_id) \
            .eq("rec_id", req.rec_id) \
            .execute()

        return {"ok": True}

    except Exception as e:
        return {"ok": False, "error": str(e)}
