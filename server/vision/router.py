# server/vision/router.py
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
import uuid

router = APIRouter(prefix="/vision", tags=["vision"])


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


@router.post("/create", response_model=CreateVisionResponse)
async def create_vision(body: CreateVisionRequest):
    # TODO: вставить реальный INSERT в Supabase (public.visions)
    vision_id = str(uuid.uuid4())
    title = f"Визия от {datetime.utcnow().date().isoformat()}"
    created_at = datetime.utcnow()
    return CreateVisionResponse(
        vision_id=vision_id,
        title=title,
        created_at=created_at,
    )


@router.post("/step", response_model=StepResponse)
async def create_step(body: StepRequest):
    # TODO: здесь потом:
    # 1) собрать контекст
    # 2) дернуть OpenAI
    ai_text = f"Заглушка ответа для: {body.user_text}"
    created_at = datetime.utcnow()
    return StepResponse(
        vision_id=body.vision_id,
        user_text=body.user_text,
        ai_text=ai_text,
        created_at=created_at,
    )
