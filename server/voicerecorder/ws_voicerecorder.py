# server/voicerecorder/ws_voicerecorder.py

import io
import os
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydub import AudioSegment
from supabase import create_client

router = APIRouter()

# --- Supabase config ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

BUCKET = "sv-storage"
FOLDER = "voicerecorder"  # => voicerecorder/user-{user_id}/{rec_id}.mp3


@router.websocket("/ws/voicerecorder")
async def ws_voicerecorder(ws: WebSocket):
    await ws.accept()
    await ws.send_text("Connected")

    meta: dict = {}
    segments: list[AudioSegment] = []

    try:
        while True:
            msg = await ws.receive()

            # ---------- TEXT ----------
            if "text" in msg:
                text = msg["text"]

                # START {"user_id":"...","rec_id":"...","ext":".wav"}
                if text.startswith("START"):
                    try:
                        payload_text = text[5:].strip()
                        payload = json.loads(payload_text or "{}")

                        meta["user_id"] = payload.get("user_id")
                        meta["rec_id"] = payload.get("rec_id") or str(uuid.uuid4())
                        meta["ext"] = payload.get("ext") or ".wav"

                        if not meta["user_id"]:
                            await ws.send_text("ERR no user_id")
                            continue

                        segments = []
                        await ws.send_text("ACK START")
                    except Exception as e:
                        await ws.send_text(f"ERR bad START: {e}")

                elif text.startswith("END"):
                    if not meta.get("user_id"):
                        await ws.send_text("ERR no user/session")
                        continue
                    if not segments:
                        await ws.send_text("ERR no segments")
                        continue

                    try:
                        # --- Склеиваем все WAV-сегменты в один AudioSegment ---
                        full_audio = segments[0]
                        for seg in segments[1:]:
                            full_audio += seg

                        # --- Конвертация в MP3 ---
                        mp3_buf = io.BytesIO()
                        full_audio.export(mp3_buf, format="mp3", bitrate="128k")
                        mp3_buf.seek(0)

                        user_id = meta["user_id"]
                        rec_id = meta["rec_id"]
                        filename = f"{rec_id}.mp3"
                        storage_path = f"{FOLDER}/user-{user_id}/{filename}"

                        # --- Загрузка в Supabase Storage ---
                        supabase.storage.from_(BUCKET).upload(storage_path, mp3_buf.read())
                        signed = supabase.storage.from_(BUCKET).create_signed_url(
                            storage_path,
                            expires_in=60 * 60 * 24 * 365 * 10  # 10 лет
                        )
                        file_url = signed.get("signedURL")

                        # --- Запись в voicerecorder_records ---
                        supabase.table("voicerecorder_records").insert({
                            "user_id": user_id,
                            "rec_id": rec_id,
                            "file_name": filename,
                            "file_url": file_url,
                            "storage_path": storage_path,
                            "format": "mp3",
                            "duration_seconds": int(full_audio.duration_seconds),
                            "size_bytes": len(mp3_buf.getvalue()),
                            "created_at": datetime.utcnow().isoformat()
                        }).execute()

                        # Ответ фронту
                        await ws.send_text(json.dumps({"status": "SAVED", "url": file_url}))
                        await ws.close(code=1000)
                        return

                    except Exception as e:
                        await ws.send_text(f"ERR processing: {e}")
                        await ws.close(code=4000)
                        return

                else:
                    await ws.send_text("ERR unknown command")

            # ---------- BINARY ----------
            elif "bytes" in msg:
                raw = msg["bytes"]
                if not raw:
                    continue

                try:
                    # Каждый бинарный chunk — полноценный WAV-сегмент (2 сек)
                    seg_audio = AudioSegment.from_file(io.BytesIO(raw), format="wav")
                    segments.append(seg_audio)
                except Exception as e:
                    await ws.send_text(f"ERR bad-segment: {e}")

    except WebSocketDisconnect:
        try:
            await ws.close(code=1001)
        except Exception:
            pass
