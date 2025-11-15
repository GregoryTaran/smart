from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, date
import os

from supabase import create_client, Client
from openai import OpenAI

# ============================================================
#  VISION ROUTER
#  Здесь лежат все эндпоинты для модуля "Путь по визии"
#  - /vision/create  — создать визию
#  - /vision/step    — добавить шаг визии + ответ ИИ
# ============================================================

# ----------- ENV / клиенты -----------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы в переменных окружения")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY не задан в переменных окружения")

# Клиент для Supabase (работаем через REST / Python SDK)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Клиент для OpenAI (новый SDK, openai>=1.x)
client = OpenAI(api_key=OPENAI_API_KEY)

# Сам роутер FastAPI. В основном app он подключается как:
# app.include_router(router, prefix="/api")
router = APIRouter(prefix="/vision", tags=["vision"])


# ----------- Модели запросов / ответов -----------

class CreateVisionRequest(BaseModel):
    """
    Тело запроса на создание визии.
    user_id — это либо svid.user_id, либо svid.visitor_id (см. фронт).
    """
    user_id: str


class CreateVisionResponse(BaseModel):
    """
    Ответ на создание визии.
    - vision_id  — технический идентификатор визии (это поле id из таблицы visions)
    - title      — человекочитаемое имя визии
    - created_at — когда она была создана
    """
    vision_id: str
    title: str
    created_at: datetime


class StepRequest(BaseModel):
    """
    Тело запроса шага визии.
    - vision_id — в какую визию пишем шаг
    - user_text — что написал пользователь на фронте
    """
    vision_id: str
    user_text: str


class StepResponse(BaseModel):
    """
    Ответ после создания шага.
    - vision_id  — ID визии, к которой относится шаг
    - user_text  — текст пользователя
    - ai_text    — ответ ассистента
    - created_at — время создания шага в БД
    """
    vision_id: str
    user_text: str
    ai_text: str
    created_at: datetime


# ----------- Вспомогательные функции -----------

def build_messages_for_openai(vision_id: str, user_text: str):
    """
    Собираем историю по визии, чтобы дать контекст модели OpenAI.

    1. Добавляем системный промпт — кто мы и как отвечаем.
    2. Достаём последние N шагов из таблицы vision_steps (для этой визии).
    3. Складываем:
       user_text -> role="user"
       ai_text   -> role="assistant"
    4. В конец добавляем текущее сообщение пользователя.
    """
    system_prompt = (
        "Ты ассистент, который помогает пользователю формулировать и развивать его визию. "
        "Говори по-русски, отвечай кратко и по делу, но по-дружески. "
        "Помогай структурировать мысли, предлагай уточняющие вопросы, если нужно."
    )

    # Начинаем с системного сообщения
    messages = [
        {"role": "system", "content": system_prompt},
    ]

    # Пытаемся подгрузить историю шагов из БД.
    # Если вдруг Supabase отвалится — просто логируем и продолжаем без истории.
    try:
        res = (
            supabase
            .table("vision_steps")
            .select("user_text, ai_text, created_at")
            .eq("vision_id", vision_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        history = list(reversed(res.data or []))

        for row in history:
            if row.get("user_text"):
                messages.append({"role": "user", "content": row["user_text"]})
            if row.get("ai_text"):
                messages.append({"role": "assistant", "content": row["ai_text"]})
    except Exception as e:
        print(f"[VISION] build_messages_for_openai error: {e}")

    # Добавляем текущее сообщение пользователя
    messages.append({"role": "user", "content": user_text})
    return messages


# ----------- Роуты -----------

@router.post("/create", response_model=CreateVisionResponse)
async def create_vision(body: CreateVisionRequest):
    """
    Эндпоинт: POST /api/vision/create

    Что делает:
    1. Проверяет, что user_id передан.
    2. Формирует человеку понятный title, например: "Визия от 14.11.2025".
    3. Создаёт строку в таблице public.visions.
       В этой таблице:
       - id         — UUID визии (это и есть наш vision_id),
       - user_id    — кто владелец (svid user / visitor),
       - title      — название визии,
       - created_at — timestamp (заполняет Supabase/Postgres).
    4. Возвращает CreateVisionResponse.
    """
    if not body.user_id:
        raise HTTPException(status_code=400, detail="user_id обязателен")

    today = date.today()
    title = f"Визия от {today.strftime('%d.%m.%Y')}"

    try:
        # Пишем визию в таблицу "visions"
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

        # Supabase должен вернуть созданную строку в res.data[0]
        if not res.data:
            raise HTTPException(status_code=500, detail="Supabase не вернул данные при создании визии")

        row = res.data[0]

        # ВАЖНО:
        # В таблице поле с ID визии называется "id" (а не "vision_id").
        vision_id = row.get("id")
        if not vision_id:
            raise HTTPException(status_code=500, detail="В ответе Supabase нет поля 'id' для визии")

        return CreateVisionResponse(
            vision_id=vision_id,
            title=row.get("title") or title,
            created_at=row["created_at"],
        )
    except HTTPException:
        # Уже оформленная ошибка, просто пробрасываем
        raise
    except Exception as e:
        # Любая другая ошибка — заворачиваем в 500 с текстом
        raise HTTPException(status_code=500, detail=f"Ошибка при создании визии: {e}")


@router.post("/step", response_model=StepResponse)
async def create_step(body: StepRequest):
    """
    Эндпоинт: POST /api/vision/step

    Что делает:
    1. Проверяет, что переданы vision_id и user_text.
    2. Собирает историю визии через build_messages_for_openai.
    3. Вызывает модель OpenAI (gpt-4o-mini) с историей + текущим текстом.
    4. Полученный ответ записывает в таблицу public.vision_steps.
       В таблице ожидаются поля:
       - vision_id
       - user_text
       - ai_text
       - created_at (автоматически в БД)
    5. Возвращает StepResponse.
    """
    if not body.vision_id:
        raise HTTPException(status_code=400, detail="vision_id обязателен")
    if not body.user_text:
        raise HTTPException(status_code=400, detail="user_text обязателен")

    try:
        # 1. Сбор контекста для модели
        messages = build_messages_for_openai(body.vision_id, body.user_text)

        # 2. Вызов OpenAI (новый SDK, openai>=1.x)
        completion = client.chat.completions.create(
            model="gpt-4o-mini-search-preview",
            messages=messages,
        )

        # Берём первый вариант ответа
        choice = completion.choices[0]
        msg = choice.message

        # Унифицированно достаём текст.
        # В новом SDK content может быть либо строкой, либо массивом частей.
        if isinstance(msg.content, str):
            ai_text = msg.content.strip()
        else:
            parts = []
            for part in msg.content:
                text = getattr(part, "text", None)
                if text:
                    parts.append(text)
            ai_text = (" ".join(parts)).strip()

        if not ai_text:
            ai_text = "У меня пока нет осмысленного ответа, попробуй переформулировать запрос."

        # 3. Запись шага в таблицу "vision_steps"
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
        # Уже нормально оформленная ошибка
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при создании шага визии: {e}")
