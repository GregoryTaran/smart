from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from datetime import datetime, date
from typing import List, Optional
from openai import OpenAI
import os

# ❗ Правильный импорт пула
import db

from auth.smart_auth import SESSION_COOKIE


router = APIRouter(prefix="/vision", tags=["vision"])

AI_USER_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


# ============================================================
# AUTH HELPERS
# ============================================================

async def get_auth_user_id(request: Request) -> Optional[str]:

    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u.id
            FROM smart_sessions s
            JOIN smart_users u ON u.id = s.user_id
            WHERE s.token = $1 AND s.expires_at > now()
            LIMIT 1
            """,
            token,
        )
        return str(row["id"]) if row else None


# ============================================================
# MODELS
# ============================================================

class CreateVisionResponse(BaseModel):
    vision_id: str
    title: str
    created_at: datetime


class StepRequest(BaseModel):
    vision_id: str
    user_text: str
    with_ai: bool = True


class StepResponse(BaseModel):
    vision_id: str
    user_text: str
    ai_text: Optional[str]
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
# HELPERS
# ============================================================

async def ensure_vision_access(conn, vision_id: str, user_id: str,
                               allowed_roles: Optional[List[str]] = None,
                               not_found_as_404: bool = True):

    row = await conn.fetchrow(
        """
        SELECT
            v.id,
            v.title,
            v.owner_id,
            v.created_at,
            v.updated_at,
            v.archived,
            vp.user_id as participant_user_id,
            vp.role as participant_role
        FROM visions v
        JOIN vision_participants vp ON vp.vision_id = v.id
        WHERE v.id = $1 AND vp.user_id = $2
        """,
        vision_id,
        user_id,
    )

    if not row:
        if not_found_as_404:
            raise HTTPException(404, "Визия не найдена или нет доступа")
        else:
            raise HTTPException(403, "Нет доступа к визии")

    role = row["participant_role"]
    if allowed_roles and role not in allowed_roles:
        raise HTTPException(403, "Недостаточно прав")

    return row


async def build_ai_response(vision_id: str, user_text: str, conn):
    if not openai_client:
        return "AI временно недоступен."

    rows = await conn.fetch(
        """
        SELECT user_text, ai_text
        FROM vision_steps
        WHERE vision_id = $1
        ORDER BY created_at ASC
        LIMIT 10
        """,
        vision_id,
    )

    messages = [
        {
            "role": "system",
            "content": "Ты дружелюбный ассистент, который помогает человеку развивать жизненную визию."
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
        messages=messages,
    )

    content = ai.choices[0].message.content
    return content.strip() if content else "Ошибка при генерации ответа."


# ============================================================
# CREATE VISION
# ============================================================

@router.post("/create", response_model=CreateVisionResponse)
async def create_vision(request: Request):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            title = f"Визия от {date.today():%d.%m.%Y}"

            row = await conn.fetchrow(
                """
                INSERT INTO visions (owner_id, title)
                VALUES ($1, $2)
                RETURNING id, title, created_at
                """,
                user_id,
                title,
            )

            vision_id = row["id"]

            await conn.execute(
                """
                INSERT INTO vision_participants (vision_id, user_id, role)
                VALUES ($1, $2, 'owner')
                ON CONFLICT (vision_id, user_id) DO NOTHING
                """,
                vision_id,
                user_id,
            )

            await conn.execute(
                """
                INSERT INTO vision_participants (vision_id, user_id, role)
                VALUES ($1, $2, 'ai')
                ON CONFLICT (vision_id, user_id) DO NOTHING
                """,
                vision_id,
                AI_USER_ID,
            )

    return CreateVisionResponse(
        vision_id=str(row["id"]),
        title=row["title"],
        created_at=row["created_at"],
    )


# ============================================================
# CREATE STEP
# ============================================================

@router.post("/step", response_model=StepResponse)
async def create_step(request: Request, body: StepRequest):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if not body.user_text:
        raise HTTPException(400, "user_text required")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:

        await ensure_vision_access(
            conn,
            vision_id=body.vision_id,
            user_id=user_id,
            allowed_roles=["owner", "editor", "ai"],
        )

        ai_text = None
        if body.with_ai:
            ai_text = await build_ai_response(body.vision_id, body.user_text, conn)

        row = await conn.fetchrow(
            """
            INSERT INTO vision_steps (vision_id, user_id, user_text, ai_text)
            VALUES ($1, $2, $3, $4)
            RETURNING vision_id, user_text, ai_text, created_at
            """,
            body.vision_id,
            user_id,
            body.user_text,
            ai_text,
        )

    return StepResponse(
        vision_id=str(row["vision_id"]),
        user_text=row["user_text"],
        ai_text=row["ai_text"],
        created_at=row["created_at"],
    )


# ============================================================
# LIST VISIONS
# ============================================================

@router.get("/list", response_model=VisionListResponse)
async def list_visions(request: Request):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT v.id, v.title, v.created_at
            FROM visions v
            JOIN vision_participants vp ON vp.vision_id = v.id
            WHERE vp.user_id = $1
              AND COALESCE(v.archived, false) = false
            ORDER BY v.created_at DESC
            """,
            user_id,
        )

    visions = [
        VisionShort(
            vision_id=str(r["id"]),
            title=r["title"],
            created_at=r["created_at"],
        )
        for r in rows
    ]

    return VisionListResponse(visions=visions)


# ============================================================
# GET VISION HISTORY
# ============================================================

@router.get("/{vision_id}")
async def get_vision(request: Request, vision_id: str):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:

        vis_row = await ensure_vision_access(
            conn,
            vision_id=vision_id,
            user_id=user_id,
            allowed_roles=None,
        )

        steps = await conn.fetch(
            """
            SELECT id, user_id, user_text, ai_text, created_at
            FROM vision_steps
            WHERE vision_id = $1
            ORDER BY created_at ASC
            """,
            vision_id,
        )

    return {
        "vision_id": str(vis_row["id"]),
        "title": vis_row["title"],
        "created_at": vis_row["created_at"],
        "archived": vis_row["archived"],
        "steps": [
            {
                "id": s["id"],
                "user_id": str(s["user_id"]),
                "user_text": s["user_text"],
                "ai_text": s["ai_text"],
                "created_at": s["created_at"],
            }
            for s in steps
        ],
    }


# ============================================================
# RENAME VISION
# ============================================================

@router.post("/rename", response_model=RenameVisionResponse)
async def rename_vision(request: Request, body: RenameVisionRequest):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:

        await ensure_vision_access(
            conn,
            vision_id=body.vision_id,
            user_id=user_id,
            allowed_roles=["owner"],
        )

        row = await conn.fetchrow(
            """
            UPDATE visions
            SET title = $1,
                updated_at = now()
            WHERE id = $2
            RETURNING id, title
            """,
            body.title.strip(),
            body.vision_id,
        )

    if not row:
        raise HTTPException(404, "Визия не найдена")

    return RenameVisionResponse(
        vision_id=str(row["id"]),
        title=row["title"],
    )


# ============================================================
# ARCHIVE / UNARCHIVE
# ============================================================

class ArchiveRequest(BaseModel):
    vision_id: str
    archived: bool


@router.post("/archive")
async def archive_vision(request: Request, body: ArchiveRequest):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:

        await ensure_vision_access(
            conn,
            vision_id=body.vision_id,
            user_id=user_id,
            allowed_roles=["owner"],
        )

        row = await conn.fetchrow(
            """
            UPDATE visions
            SET archived = $1,
                updated_at = now()
            WHERE id = $2
            RETURNING id, archived
            """,
            body.archived,
            body.vision_id,
        )

        if not row:
            raise HTTPException(404, "Визия не найдена")

    return {
        "vision_id": str(row["id"]),
        "archived": row["archived"],
    }


# ============================================================
# DELETE VISION
# ============================================================

class DeleteRequest(BaseModel):
    vision_id: str


@router.post("/delete")
async def delete_vision(request: Request, body: DeleteRequest):
    user_id = await get_auth_user_id(request)
    if not user_id:
        raise HTTPException(401, "Unauthorized")

    if db.pool is None:
        raise HTTPException(500, "Database connection not initialized")

    async with db.pool.acquire() as conn:

        await ensure_vision_access(
            conn,
            vision_id=body.vision_id,
            user_id=user_id,
            allowed_roles=["owner"],
        )

        await conn.execute(
            """
            DELETE FROM visions
            WHERE id = $1
            """,
            body.vision_id,
        )

    return {"status": "deleted", "vision_id": body.vision_id}
