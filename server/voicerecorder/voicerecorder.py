from fastapi import FastAPI, UploadFile, File
from supabase import create_client
import os, uuid

app = FastAPI(title="Voicerecorder SubApp")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

BUCKET = "sv-storage"
FOLDER = "VoiceRecorder"

@app.get("/voicerecorder/ping")
def ping():
    return {"ok": True, "service": "voicerecorder", "mounted": True}

@app.post("/voicerecorder/test-upload")
async def test_upload(file: UploadFile = File(...)):
    """Тестовая загрузка файла в Supabase Storage (через саб‑приложение).
    Окончательный путь: /api/voicerecorder/test-upload (смонтировано в main.py)
    """
    try:
        test_id = uuid.uuid4().hex[:8]
        filename = file.filename or f"test_{test_id}.wav"
        path = f"{FOLDER}/test/{filename}"

        data = await file.read()
        res = supabase.storage.from_(BUCKET).upload(
            path, data, {"content-type": file.content_type}
        )
        if isinstance(res, dict) and res.get("error"):
            return {"ok": False, "error": res["error"]}

        signed = supabase.storage.from_(BUCKET).create_signed_url(path, expires_in=24*3600)
        signed_url = signed.get("signedURL") if isinstance(signed, dict) else None

        return {"ok": True, "file": filename, "path": path, "url": signed_url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
