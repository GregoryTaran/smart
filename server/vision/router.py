from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from datetime import datetime, date
from typing import List, Optional
import os

from supabase import create_client, Client
from openai import OpenAI

# ============================================================
#  VISION ROUTER
#  Здесь лежат все эндпоинты для модуля "Путь по визии"
#  - POST /vision/create     — создать визию (теперь по auth-сессии)
#  - POST /vision/step       — добавить шаг визии + ответ ИИ
#  - GET  /vision/{id}       — получить визию и историю шагов
#  - GET  /vision/list       — получить список визий пользователя
# ============================================================

# ----------- ENV / клиенты -----------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
  raise RuntimeError("SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы в переменных окружения")

if not OPENAI_API_KEY:
  raise RuntimeError("OPENAI_API_KEY не задан в переменных окружения")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)

router = APIRouter(prefix="/vision", tags=["vision"])


# ============================================================
#           Pydantic-модели запросов / ответов
# ============================================================

class CreateVisionRequest(BaseModel):
  """
  Старый вариант: user_id из тела.
  Оставлен для обратной совместимости, но сейчас
  user_id берём из сессии.
  """
  user_id: Optional[str] = None


class CreateVisionResponse(BaseModel):
  """Ответ на создание визии."""
  vision_id: str
  title: str
  created_at: datetime


class StepRequest(BaseModel):
  """Тело запроса шага визии."""
  vision_id: str
  user_text: str


class StepResponse(BaseModel):
  """Ответ после создания шага."""
  vision_id: str
  user_text: str
  ai_text: str
  created_at: datetime


# ----- Модели для истории визии -----

class VisionStepInHistory(BaseModel):
  """
  Один шаг визии в истории:
  - user_text — что написал человек
  - ai_text   — что ответил ассистент
  """
  id: str
  user_text: Optional[str]
  ai_text: Optional[str]
  created_at: datetime


class VisionHistoryResponse(BaseModel):
  """
  Ответ для GET /vision/{vision_id}:
  - данные по визии
  - массив шагов (история)
  """
  vision_id: str
  title: str
  created_at: datetime
  steps: List[VisionStepInHistory]


class VisionShort(BaseModel):
  """Короткая информация о визии для списка."""
  vision_id: str
  title: str
  created_at: datetime


class VisionListResponse(BaseModel):
  """Ответ для GET /vision/list."""
  visions: List[VisionShort]


# ============================================================
#           ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================

def _extract_auth_user_id(request: Request) -> Optional[str]:
  """
  Пробуем вытащить user_id из новой системы авторизации.
  Ожидаем, что middleware уже положил auth / user в request.state.
  """
  try:
    user = getattr(request.state, "user", None)
    if user and isinstance(user, dict) and user.get("user_id"):
      return str(user["user_id"])
  except Exception:
    pass

  try:
    auth = getattr(request.state, "auth", None)
    if auth and isinstance(auth, dict) and auth.get("user_id"):
      return str(auth["user_id"])
  except Exception:
    pass

  return None


def build_messages_for_openai(vision_id: str, user_text: str):
  """
  Собираем историю по визии, чтобы дать контекст модели OpenAI.
  Берём последние N шагов и добавляем текущий текст пользователя.
  """
  system_prompt = (
    "Ты ассистент, который помогает пользователю формулировать и развивать его визию. "
    "Говори по-русски, отвечай кратко и по делу, но по-дружески. "
    "Помогай структурировать мысли, предлагай уточняющие вопросы, если нужно."
  )

  messages = [
    {"role": "system", "content": system_prompt},
  ]

  # Пробуем достать из базы последние шаги визии
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
  except Exception as e:
    print(f"[VISION] build_messages_for_openai error: {e}")
    history = []

  # Добавляем историю диалога в messages
  for row in history:
    if row.get("user_text"):
      messages.append({"role": "user", "content": row["user_text"]})
    if row.get("ai_text"):
      messages.append({"role": "assistant", "content": row["ai_text"]})

  # И в конце — текущий запрос пользователя
  messages.append({"role": "user", "content": user_text})

  return messages


# ============================================================
#                       РОУТЫ
# ============================================================

@router.post("/create", response_model=CreateVisionResponse)
async def create_vision(request: Request, body: Optional[CreateVisionRequest] = None):
  """
  POST /api/vision/create
  Создаём визию и возвращаем её id + title.
  Теперь user_id берём из новой auth-системы.
  """
  user_id = _extract_auth_user_id(request)

  # Фоллбек на старый вариант, если вдруг auth ещё не подключили
  if not user_id and body and body.user_id:
    user_id = body.user_id

  if not user_id:
    raise HTTPException(status_code=401, detail="Не удалось определить пользователя (нет сессии)")

  today = date.today()
  title = f"Визия от {today.strftime('%d.%m.%Y')}"

  try:
    res = (
      supabase
      .table("visions")
      .insert(
        {
          "user_id": user_id,
          "title": title,
        }
      )
      .execute()
    )

    if not res.data:
      raise HTTPException(status_code=500, detail="Supabase не вернул данные при создании визии")

    row = res.data[0]
    vision_id = row.get("id")
    if not vision_id:
      raise HTTPException(status_code=500, detail="В ответе Supabase нет поля 'id' для визии")

    return CreateVisionResponse(
      vision_id=vision_id,
      title=row.get("title") or title,
      created_at=row["created_at"],
    )
  except HTTPException:
    raise
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Ошибка при создании визии: {e}")


@router.post("/step", response_model=StepResponse)
async def create_step(request: Request, body: StepRequest):
  """
  POST /api/vision/step
  Добавляем шаг визии и получаем ответ ИИ.
  """
  if not body.vision_id:
    raise HTTPException(status_code=400, detail="vision_id обязателен")
  if not body.user_text:
    raise HTTPException(status_code=400, detail="user_text обязателен")

  # Если включена новая авторизация, проверяем, что визия принадлежит пользователю
  auth_user_id = _extract_auth_user_id(request)

  if auth_user_id:
    try:
      vis_check = (
        supabase
        .table("visions")
        .select("id, user_id")
        .eq("id", body.vision_id)
        .limit(1)
        .execute()
      )
      if not vis_check.data:
        raise HTTPException(status_code=404, detail="Визия не найдена")
      vis_row = vis_check.data[0]
      if str(vis_row.get("user_id")) != auth_user_id:
        raise HTTPException(status_code=403, detail="Нет доступа к этой визии")
    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(status_code=500, detail=f"Ошибка при проверке доступа к визии: {e}")

  try:
    # 1. Собираем сообщения для OpenAI (контекст)
    messages = build_messages_for_openai(body.vision_id, body.user_text)

    # 2. Делаем запрос к OpenAI (новый клиент, модель с поиском)
    completion = openai_client.chat.completions.create(
      model="gpt-4o-mini-search-preview",
      messages=messages,
    )

    choice = completion.choices[0]
    msg = choice.message

    # msg.content может быть строкой или массивом частей
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

    # 3. Сохраняем шаг в Supabase
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


@router.get("/{vision_id}", response_model=VisionHistoryResponse)
async def get_vision_history(request: Request, vision_id: str):
  """
  GET /api/vision/{vision_id}

  Что делает:
  1. Находит визию в таблице visions.
  2. Проверяет, что она принадлежит текущему пользователю (если подключена auth).
  3. Находит все её шаги в vision_steps.
  4. Возвращает:
     - id, title, created_at визии
     - список шагов (user_text + ai_text) по порядку.
  """
  auth_user_id = _extract_auth_user_id(request)

  # 1. Ищем саму визию
  try:
    vis_res = (
      supabase
      .table("visions")
      .select("id, user_id, title, created_at")
      .eq("id", vision_id)
      .limit(1)
      .execute()
    )
    if not vis_res.data:
      raise HTTPException(status_code=404, detail="Визия не найдена")

    vis_row = vis_res.data[0]

    if auth_user_id and str(vis_row.get("user_id")) != auth_user_id:
      raise HTTPException(status_code=403, detail="Нет доступа к этой визии")
  except HTTPException:
    raise
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Ошибка при чтении визии: {e}")

  # 2. Ищем шаги
  try:
    steps_res = (
      supabase
      .table("vision_steps")
      .select("id, user_text, ai_text, created_at")
      .eq("vision_id", vision_id)
      .order("created_at", desc=False)
      .execute()
    )
    steps_data = steps_res.data or []
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Ошибка при чтении шагов визии: {e}")

  steps: List[VisionStepInHistory] = []
  for row in steps_data:
    steps.append(
      VisionStepInHistory(
        id=row["id"],
        user_text=row.get("user_text"),
        ai_text=row.get("ai_text"),
        created_at=row["created_at"],
      )
    )

  return VisionHistoryResponse(
    vision_id=vis_row["id"],
    title=vis_row.get("title") or "",
    created_at=vis_row["created_at"],
    steps=steps,
  )


@router.get("/list", response_model=VisionListResponse)
async def list_my_visions(request: Request):
  """
  GET /api/vision/list
  Возвращает список визий текущего пользователя.
  """
  user_id = _extract_auth_user_id(request)
  if not user_id:
    raise HTTPException(status_code=401, detail="Не удалось определить пользователя (нет сессии)")

  try:
    res = (
      supabase
      .table("visions")
      .select("id, title, created_at")
      .eq("user_id", user_id)
      .order("created_at", desc=True)
      .execute()
    )

    rows = res.data or []
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Ошибка при получении списка визий: {e}")

  visions: List[VisionShort] = []
  for row in rows:
    visions.append(
      VisionShort(
        vision_id=row["id"],
        title=row.get("title") or "",
        created_at=row["created_at"],
      )
    )

  return VisionListResponse(visions=visions)
