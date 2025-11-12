# server/voicerecorder/ws_voicerecorder.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from supabase import create_client
import os, io, uuid

router = APIRouter()

# Подключаем Supabase
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

BUCKET = "sv-storage"
FOLDER = "VoiceRecorder"

@router.websocket("/ws/voicerecorder")
async def ws_voicerecorder(websocket: WebSocket):
    await websocket.accept()
    file_buffer = io.BytesIO()
    rec_id = uuid.uuid4().hex[:8]
    user_id = "test-user"  # потом заменим на реальный из SVID

    try:
        await websocket.send_text(f"Connected. Recording id: {rec_id}")
        while True:
            data = await websocket.receive_bytes()
            file_buffer.write(data)

    except WebSocketDisconnect:
        # клиент завершил запись
        file_buffer.seek(0)
        path = f"{FOLDER}/user-{user_id}/{rec_id}.wav"
        res = supabase.storage.from_(BUCKET).upload(
            path, file_buffer.read(), {"content-type": "audio/wav"}
        )

        if res.get("error"):
            await websocket.close(code=4000)
            return

        signed = supabase.storage.from_(BUCKET).create_signed_url(
            path, expires_in=24 * 3600
        )
        await websocket.send_text(f"Saved: {signed.get('signedURL')}")
        await websocket.close(code=1000)
