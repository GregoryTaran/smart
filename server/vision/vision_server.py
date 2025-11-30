from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
import os

from supabase import create_client
from openai import OpenAI


# =====================================================
#  INIT + SAFETY CHECKS
# =====================================================

router = APIRouter(tags=["Vision Module"])

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

AI_USER_EMAIL = "ai@smartvision.local"


# =====================================================
#  MODELS
# =====================================================

class CreateRequest(BaseModel):
    user_id: str


class StepRequest(BaseModel):
    vision_id: str
    user_id: str
    user_text: str
    with_ai: bool = True


class RenameRequest(BaseModel):
    vision_id: str
    user_id: str
    title: str


class ArchiveRequest(BaseModel):
    vision_id: str
    user_id: str
    archived: bool


class DeleteRequest(BaseModel):
    vision_id: str
    user_id: str


class AddParticipantRequest(BaseModel):
    vision_id: str
    user_id: str
    email: str


class RemoveParticipantRequest(BaseModel):
    vision_id: str
    user_id: str
    participant_id: str


# =====================================================
#  HELPERS
# =====================================================

def require_user(user_id: Optional[str]):
    # Дополнительная защита: строковое 'null' и пустые значения
    if not user_id or user_id == "null":
        raise HTTPException(401, "user_id отсутствует")
    return user_id


async def get_participant_role(vision_id: str, user_id: str) -> Optional[str]:
    res = supabase.table("vision_participants") \
        .select("role") \
        .eq("vision_id", vision_id) \
        .eq("user_id", user_id) \
        .execute()

    return res.data[0]["role"] if res.data else None


async def ensure_access(vision_id: str,
                        user_id: str,
                        allowed_roles: List[str]):
    require_user(user_id)

    role = await get_participant_role(vision_id, user_id)
    if role is None:
        raise HTTPException(404, "Визия недоступна")

    if role not in allowed_roles:
        raise HTTPException(403, "Нет прав для этого действия")


async def load_participants(vision_id: str):
    res = supabase.table("vision_participants") \
        .select("vision_id,user_id,role,added_at") \
        .eq("vision_id", vision_id) \
        .execute().data

    if not res:
        return []

    ids = [p["user_id"] for p in res]

    users = supabase.table("smart_users") \
        .select("id,email,name") \
        .in_("id", ids) \
        .execute().data

    u_map = {u["id"]: u for u in users}

    participants = []
    for p in res:
        info = u_map.get(p["user_id"], {})
        participants.append({
            "vision_id": p["vision_id"],
            "user_id": p["user_id"],
            "role": p["role"],
            "added_at": p["added_at"],
            "email": info.get("email"),
            "name": info.get("name"),
        })

    return participants


async def load_steps_with_names(vision_id: str):
    steps = supabase.table("vision_steps") \
        .select("id,vision_id,user_id,user_text,ai_text,created_at") \
        .eq("vision_id", vision_id) \
        .order("created_at", desc=False) \
        .execute().data

    if not steps:
        return []

    ids = list({s["user_id"] for s in steps})

    users = supabase.table("smart_users") \
        .select("id,email,name") \
        .in_("id", ids) \
        .execute().data

    u_map = {u["id"]: u for u in users}

    for s in steps:
        s["user_name"] = u_map.get(s["user_id"], {}).get("name")
        s["user_email"] = u_map.get(s["user_id"], {}).get("email")

    return steps


def build_ai_answer(history: List[dict], user_text: str):
    """
    Генерация AI ответа на основе 30 предыдущих шагов.
    """

    if not openai_client:
        return "AI недоступен."

    messages = [
        {
            "role": "system",
            "content": (
                "Ты — дружелюбный, умный ассистент, который помогает человеку "
                "развивать свою жизненную визию. Говори понятно, по-человечески."
            ),
        }
    ]

    # Берём до 30 последних шагов
    for step in history[-30:]:
        if step.get("user_text"):
            messages.append({"role": "user", "content": step["user_text"]})
        if step.get("ai_text"):
            messages.append({"role": "assistant", "content": step["ai_text"]})

    messages.append({"role": "user", "content": user_text})

    resp = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )

    text = resp.choices[0].message.content
    return text.strip() if text else ""


# =====================================================
#  CREATE VISION
# =====================================================

@router.post("/vision/create")
async def create_vision(request: Request):
    body = await request.json()
    user_id = require_user(body.get("user_id"))

    res = supabase.table("visions").insert({
        "owner_id": user_id,
        "title": "Моя визия",
        "archived": False,
    }).execute()

    if not res.data:
        raise HTTPException(500, "Ошибка создания визии")

    vision = res.data[0]
    vid = vision["id"]

    # добавляем owner + ai как участников
    # находим/создаём AI
    ai_user = supabase.table("smart_users") \
        .select("id") \
        .eq("email", AI_USER_EMAIL) \
        .execute().data

    if ai_user:
        ai_id = ai_user[0]["id"]
    else:
        ai = supabase.table("smart_users").insert({
            "email": AI_USER_EMAIL,
            "name": "SMART AI",
            "role": "system",
        }).execute().data[0]
        ai_id = ai["id"]

    supabase.table("vision_participants").insert([
        {"vision_id": vid, "user_id": user_id, "role": "owner"},
        {"vision_id": vid, "user_id": ai_id, "role": "ai"},
    ]).execute()

    return {"vision_id": vid}


# =====================================================
#  ADD PARTICIPANT
# =====================================================

@router.post("/vision/add_participant")
async def add_participant(req: AddParticipantRequest):
    await ensure_access(req.vision_id, req.user_id, ["owner"])

    # нельзя добавить самого себя
    owner_row = supabase.table("smart_users").select("email").eq("id", req.user_id).execute()
    owner_email = owner_row.data[0]["email"]

    if req.email == owner_email:
        raise HTTPException(400, "Нельзя добавить самого себя как участника")

    # ищем пользователя по email
    u = supabase.table("smart_users") \
        .select("id,email") \
        .eq("email", req.email) \
        .execute().data

    if not u:
        raise HTTPException(400, "Пользователь с таким email не найден")

    add_id = u[0]["id"]

    # проверяем уже есть ли
    check = supabase.table("vision_participants") \
        .select("user_id") \
        .eq("vision_id", req.vision_id) \
        .eq("user_id", add_id) \
        .execute()

    if check.data:
        raise HTTPException(409, "Участник уже существует")

    supabase.table("vision_participants").insert({
        "vision_id": req.vision_id,
        "user_id": add_id,
        "role": "participant",
    }).execute()

    return {"status": "ok"}


# =====================================================
#  REMOVE PARTICIPANT
# =====================================================

@router.post("/vision/remove_participant")
async def remove_participant(req: RemoveParticipantRequest):
    await ensure_access(req.vision_id, req.user_id, ["owner"])

    # нельзя удалить владельца или AI
    p = supabase.table("vision_participants") \
        .select("role") \
        .eq("vision_id", req.vision_id) \
        .eq("user_id", req.participant_id) \
        .execute().data

    if not p:
        raise HTTPException(404, "Участник не найден")

    role = p[0]["role"]
    if role in ("owner", "ai"):
        raise HTTPException(403, "Нельзя удалить владельца или AI")

    supabase.table("vision_participants") \
        .delete() \
        .eq("vision_id", req.vision_id) \
        .eq("user_id", req.participant_id) \
        .execute()

    return {"status": "ok"}


# =====================================================
#  GET PARTICIPANTS
# =====================================================

@router.get("/vision/get_participants")
async def get_participants(vision_id: str, user_id: str):
    # проверяем, что пользователь имеет доступ к визии
    await ensure_access(vision_id, user_id, ["owner", "participant", "ai"])
    return await load_participants(vision_id)


# =====================================================
#  LIST VISIONS
# =====================================================

@router.get("/vision/list")
async def list_visions(user_id: str):
    require_user(user_id)

    part = supabase.table("vision_participants") \
        .select("vision_id") \
        .eq("user_id", user_id) \
        .execute().data

    vision_ids = [p["vision_id"] for p in part]

    if not vision_ids:
        return []

    visions = supabase.table("visions") \
        .select("*") \
        .in_("id", vision_ids) \
        .execute().data

    return visions


# =====================================================
#  GET VISION FULL
# =====================================================

@router.get("/vision/{vision_id}")
async def get_vision(vision_id: str, user_id: str):
    require_user(user_id)

    await ensure_access(vision_id, user_id, ["owner", "participant", "ai"])

    v = supabase.table("visions") \
        .select("*") \
        .eq("id", vision_id) \
        .single() \
        .execute().data

    if not v:
        raise HTTPException(404, "Визия не найдена")

    steps = await load_steps_with_names(vision_id)
    participants = await load_participants(vision_id)

    return {
        "vision": v,
        "steps": steps,
        "participants": participants,
    }


# =====================================================
#  ADD STEP
# =====================================================

@router.post("/vision/step")
async def add_step(req: StepRequest):
    require_user(req.user_id)

    if not req.user_text.strip():
        raise HTTPException(400, "Текст пустой")

    await ensure_access(req.vision_id, req.user_id, ["owner", "participant", "ai"])

    # вставка шага
    step = supabase.table("vision_steps").insert({
        "vision_id": req.vision_id,
        "user_id": req.user_id,
        "user_text": req.user_text,
    }).execute().data[0]

    ai_text = None

    if req.with_ai:
        history = supabase.table("vision_steps") \
            .select("user_text,ai_text") \
            .eq("vision_id", req.vision_id) \
            .order("created_at", desc=False) \
            .execute().data

        ai_text = build_ai_answer(history, req.user_text)

        supabase.table("vision_steps") \
            .update({"ai_text": ai_text}) \
            .eq("id", step["id"]) \
            .execute()

    return {
        "vision_id": req.vision_id,
        "user_text": req.user_text,
        "ai_text": ai_text,
    }


# =====================================================
#  RENAME
# =====================================================

@router.post("/vision/rename")
async def rename_vision(req: RenameRequest):
    await ensure_access(req.vision_id, req.user_id, ["owner"])

    supabase.table("visions") \
        .update({"title": req.title, "updated_at": datetime.utcnow().isoformat()}) \
        .eq("id", req.vision_id) \
        .execute()

    return {"status": "ok", "title": req.title}


# =====================================================
#  ARCHIVE
# =====================================================

@router.post("/vision/archive")
async def archive_vision(req: ArchiveRequest):
    await ensure_access(req.vision_id, req.user_id, ["owner"])

    supabase.table("visions") \
        .update({"archived": req.archived, "updated_at": datetime.utcnow().isoformat()}) \
        .eq("id", req.vision_id) \
        .execute()

    return {"status": "ok", "archived": req.archived}


# =====================================================
#  DELETE
# =====================================================

@router.post("/vision/delete")
async def delete_vision(req: DeleteRequest):
    await ensure_access(req.vision_id, req.user_id, ["owner"])

    supabase.table("vision_steps").delete().eq("vision_id", req.vision_id).execute()
    supabase.table("vision_participants").delete().eq("vision_id", req.vision_id).execute()
    supabase.table("visions").delete().eq("id", req.vision_id).execute()

    return {"status": "ok", "deleted": req.vision_id}
