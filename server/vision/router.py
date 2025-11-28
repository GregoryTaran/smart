# ============================================================
#   SMART VISION — новый модуль Vision без Supabase SDK
# ============================================================

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from datetime import datetime, date
from typing import List, Optional
import asyncpg
import os
from openai import OpenAI

router = APIRouter(prefix="/vision", tags=["vision"])

# ------------------------ DB CONNECTION ------------------------
DB_CONN = os.getenv("DATABASE_URL") or os.getenv("DB_CONN")

if not DB_CONN:
    raise RuntimeError("DATABASE_URL / DB_CONN not found in env")

async def db():
    return await asyncpg.connect(DB_CONN)


# ------------------------ OPENAI -------------------------------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=OPENAI_API_KEY)


# ------------------------ AUTH HELPER --------------------------
async def get_auth_user_id(request: Request) -> Optional[str]:
    """
    Достаём user_id из новой auth-системы.
    smart_auth.py кладёт пользователя в request.state.user
    """
    u = getattr(request.state, "user", None)
    if not u:
        return None

    return u.get("id") or u.get("user_id")


# ============================================================
#                    Pydantic модели
# ============================================================

class CreateVisionResponse(BaseModel):
    vision_id: str
    title: str
    created_at: datetime


class StepRequest(BaseModel):
    vision_id: str
    user_text: str


class StepResponse(BaseModel):
    vision_id: str
    user_text: str
    ai_text: str
    created_at: datetime


class VisionShort(BaseModel):
    vision_id: str
    title: str
    created_at: datetime


class VisionListResponse(BaseModel):
    visions: List[VisionShort]


class RenameVisionRequest(BaseModel):
    vision_id: str
    title: str


class RenameVisionResponse(BaseModel):
    vision_id: str
    title: str


# ============================================================
#                  CREATE VISION
# ============================================================

@router.post("/create", response_model=CreateVisionResponse)
async def create_vision(request: Request):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    conn = await db()

    title = f"Визия от {date.today():%d.%m.%Y}"

    row = await conn.fetchrow(
        """
        INSERT INTO visions (user_id, title)
        VALUES ($1, $2)
        RETURNING id, title, created_at
        """,
        user_id, title
    )

    await conn.close()

    return CreateVisionResponse(
        vision_id=str(row["id"]),
        title=row["title"],
        created_at=row["created_at"],
    )


# ============================================================
#                  ADD VISION STEP
# ============================================================

async def build_ai_response(vision_id: str, user_text: str, conn):
    """Собираем историю и отправляем запрос в OpenAI."""
    rows = await conn.fetch(
        """
        SELECT user_text, ai_text
        FROM vision_steps
        WHERE vision_id = $1
        ORDER BY created_at ASC
        LIMIT 10
        """,
        vision_id
    )

    messages = [
        {
            "role": "system",
            "content": "Ты дружелюбный ассистент, который помогает формулировать визию."
        }
    ]

    for row in rows:
        if row["user_text"]:
            messages.append({"role": "user", "content": row["user_text"]})
        if row["ai_text"]:
            messages.append({"role": "assistant", "content": row["ai_text"]})

    messages.append({"role": "user", "content": user_text})

    ai = openai_client.chat.completions.create(
        model="gpt-4o-mini-search-preview",
        messages=messages
    )

    content = ai.choices[0].message.content
    return content.strip() if content else "Не удалось сформировать ответ."


@router.post("/step", response_model=StepResponse)
async def create_step(request: Request, body: StepRequest):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if not body.user_text:
        raise HTTPException(400, "user_text required")

    conn = await db()

    # Проверяем владельца визии
    owner = await conn.fetchrow(
        "SELECT user_id FROM visions WHERE id = $1",
        body.vision_id
    )

    if not owner:
        await conn.close()
        raise HTTPException(404, "Визия не найдена")

    if str(owner["user_id"]) != str(user_id):
        await conn.close()
        raise HTTPException(403, "Нет доступа к визии")

    # Генерация ответа ИИ
    ai_text = await build_ai_response(body.vision_id, body.user_text, conn)

    # Сохраняем шаг
    row = await conn.fetchrow(
        """
        INSERT INTO vision_steps (vision_id, user_text, ai_text)
        VALUES ($1, $2, $3)
        RETURNING vision_id, user_text, ai_text, created_at
        """,
        body.vision_id, body.user_text, ai_text
    )

    await conn.close()

    return StepResponse(
        vision_id=row["vision_id"],
        user_text=row["user_text"],
        ai_text=row["ai_text"],
        created_at=row["created_at"]
    )


# ============================================================
#                  LIST VISIONS
# ============================================================

@router.get("/list", response_model=VisionListResponse)
async def list_visions(request: Request):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    conn = await db()

    rows = await conn.fetch(
        """
        SELECT id, title, created_at
        FROM visions
        WHERE user_id = $1
        ORDER BY created_at DESC
        """,
        user_id
    )

    await conn.close()

    visions = [
        VisionShort(
            vision_id=str(r["id"]),
            title=r["title"],
            created_at=r["created_at"]
        )
        for r in rows
    ]

    return VisionListResponse(visions=visions)


# ============================================================
#                  GET VISION HISTORY
# ============================================================

@router.get("/{vision_id}")
async def get_vision(request: Request, vision_id: str):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    conn = await db()

    vis = await conn.fetchrow(
        """
        SELECT id, user_id, title, created_at
        FROM visions
        WHERE id = $1
        """,
        vision_id
    )

    if not vis:
        await conn.close()
        raise HTTPException(404, "Визия не найдена")

    if str(vis["user_id"]) != str(user_id):
        await conn.close()
        raise HTTPException(403, "Нет доступа к визии")

    steps = await conn.fetch(
        """
        SELECT id, user_text, ai_text, created_at
        FROM vision_steps
        WHERE vision_id = $1
        ORDER BY created_at ASC
        """,
        vision_id
    )

    await conn.close()

    return {
        "vision_id": str(vis["id"]),
        "title": vis["title"],
        "created_at": vis["created_at"],
        "steps": [
            {
                "id": s["id"],
                "user_text": s["user_text"],
                "ai_text": s["ai_text"],
                "created_at": s["created_at"]
            }
            for s in steps
        ]
    }


# ============================================================
#                  RENAME VISION
# ============================================================

@router.post("/rename", response_model=RenameVisionResponse)
async def rename_vision(request: Request, body: RenameVisionRequest):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    conn = await db()

    owner = await conn.fetchrow(
        "SELECT user_id FROM visions WHERE id = $1",
        body.vision_id
    )

    if not owner:
        await conn.close()
        raise HTTPException(404, "Визия не найдена")

    if str(owner["user_id"]) != str(user_id):
        await conn.close()
        raise HTTPException(403, "Нет доступа")

    row = await conn.fetchrow(
        """
        UPDATE visions
        SET title = $1
        WHERE id = $2
        RETURNING id, title
        """,
        body.title.strip(), body.vision_id
    )

    await conn.close()

    return RenameVisionResponse(
        vision_id=str(row["id"]),
        title=row["title"]
    )
