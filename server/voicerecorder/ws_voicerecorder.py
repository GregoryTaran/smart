# server/voicerecorder/ws_voicerecorder.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import io, os, json, uuid
from datetime import datetime
from pydub import AudioSegment
from supabase import create_client

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

BUCKET = "sv-storage"
FOLDER = "voicerecorder"

@router.websocket("/ws/voicerecorder")
async def ws_voicerecorder(ws: WebSocket):
    await ws.accept()
    await ws.send_text("Connected")

    buf = None
    meta = {}

    try:
        while True:
            msg = await ws.receive()

            # ---- TEXT ----
            if "text" in msg:
                text = msg["text"]

                # START {"user_id":"...","rec_id":"...","ext":".wav"}
                if text.startswith("START"):
                    try:
                        payload = json.loads(text[5:].strip())
                        meta["user_id"] = payload.get("user_id")
                        meta["rec_id"] = payload.get("rec_id") or str(uuid.uuid4())
                        meta["ext"] = payload.get("ext") or ".wav"
                        buf = io.BytesIO()
                        await ws.send_text("ACK START")
                    except Exception as e:
                        await ws.send_text(f"ERR bad START: {e}")

                elif text.startswith("END"):
                    if not buf:
                        await ws.send_text("ERR no buffer")
                        continue

                    try:
                        buf.seek(0)
                        # Склеенный WAV в память → конвертируем в MP3
                        wav_audio = AudioSegment.from_file(buf, format="wav")
                        mp3_buf = io.BytesIO()
                        wav_audio.export(mp3_buf, format="mp3", bitrate="128k")
                        mp3_buf.seek(0)

                        user_id = meta["user_id"]
                        rec_id = meta["rec_id"]
                        filename = f"{rec_id}.mp3"
                        storage_path = f"{FOLDER}/user-{user_id}/{filename}"

                        # Загружаем в Storage
                        supabase.storage.from_(BUCKET).upload(storage_path, mp3_buf.read())
                        signed = supabase.storage.from_(BUCKET).create_signed_url(storage_path, expires_in=60*60*24*365*10)
                        file_url = signed.get("signedURL")

                        # Пишем в БД
                        supabase.table("voicerecorder_records").insert({
                            "user_id": user_id,
                            "rec_id": rec_id,
                            "file_name": filename,
                            "file_url": file_url,
                            "storage_path": storage_path,
                            "format": "mp3",
                            "duration_seconds": int(wav_audio.duration_seconds),
                            "size_bytes": len(mp3_buf.getvalue()),
                            "created_at": datetime.utcnow().isoformat()
                        }).execute()

                        await ws.send_text(json.dumps({"status": "SAVED", "url": file_url}))
                        await ws.close(code=1000)
                        return

                    except Exception as e:
                        await ws.send_text(f"ERR processing: {e}")
                        await ws.close(code=4000)
                        return

                else:
                    await ws.send_text("ERR unknown command")

            # ---- BINARY ----
            elif "bytes" in msg:
                if not buf:
                    await ws.send_text("ERR no START")
                    continue
                buf.write(msg["bytes"])

    except WebSocketDisconnect:
        try:
            await ws.close(code=1001)
        except:
            pass
