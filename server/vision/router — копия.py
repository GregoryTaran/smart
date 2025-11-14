from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, date
import os

from supabase import create_client, Client
import openai

# ----------- ENV / клиенты -----------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы в переменных окружения")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY не задан в переменных окружения")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
openai.api_key = OPENAI_API_KEY

router = APIRouter(prefix="/vision", tags=["vision"])

# ----------- Модели -----------

class CreateVisionRequest(BaseModel):
    user_id: str


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


# ----------- Хелпер: сбор контекста -----------

def build_messages_for_openai(vision_id: str, user_text: str):
    """
    Берём последние шаги по этой визии и собираем простой контекст для OpenAI.
    Если шагов нет – просто текущий вопрос.
    """
    history = []
    try:
        res = (
            supabase.table("vision_steps")
            .select("user_text, ai_text")
            .eq("vision_id", vision_id)
            .order("created_at", desc=False)
            .limit(10)
            .execute()
        )
        history = res.data or []
    except Exception:
        # На этапе MVP можно молча проглотить — просто не будет истории
        history = []

    messages = [
        {
            "role": "system",
            "content": "Ты помощник, который помогает человеку двигаться к своей визии. Отвечай ясно, по делу и поддерживающе.",
        }
    ]

    for step in history:
        if step.get("user_text"):
            messages.append({"role": "user", "content": step["user_text"]})
        if step.get("ai_text"):
            messages.append({"role": "assistant", "content": step["ai_text"]})

    messages.append({"role": "user", "content": user_text})
    return messages


# ----------- Роуты -----------

@router.post("/create", response_model=CreateVisionResponse)
async def create_vision(body: CreateVisionRequest):
    """
    Создаёт визию в public.visions.
    """
    try:
        title = f"Визия от {date.today().strftime('%d.%m.%Y')}"
        res = (
            supabase
            .table("visions")
            .insert(
                {
                    "user_id": body.user_id,
                    "title": title,
                }
            )
            .execute()
        )

        if not res.data:
            raise HTTPException(status_code=500, detail="Supabase не вернул данные при создании визии")

        row = res.data[0]
        return CreateVisionResponse(
            vision_id=row["id"],
            title=row["title"],
            created_at=row["created_at"],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при создании визии: {e}")


@router.post("/step", response_model=StepResponse)
async def create_step(body: StepRequest):
    """
    Создаёт шаг в public.vision_steps и возвращает его.
    Здесь уже дергаем OpenAI.
    """
    try:
        # 1. Сбор контекста
        messages = build_messages_for_openai(body.vision_id, body.user_text)

        # 2. Вызов OpenAI (если нужна другая модель — просто поменяй имя)
        completion = openai.ChatCompletion.create(
            model="gpt-4o-mini",
            messages=messages,
        )
        ai_text = completion.choices[0].message["content"].strip()

        # 3. Запись шага в БД
        res = (
            supabase
            .table("vision_steps")
            .insert(
                {
                    "vision_id": body.vision_id,
                    "user_text": body.user_text,
                    "ai_text": ai_text,
                }
            )
            .execute()
        )

        if not res.data:
            raise HTTPException(status_code=500, detail="Supabase не вернул данные при создании шага")

        row = res.data[0]
        return StepResponse(
            vision_id=row["vision_id"],
            user_text=row["user_text"],
            ai_text=row["ai_text"],
            created_at=row["created_at"],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при создании шага визии: {e}")
