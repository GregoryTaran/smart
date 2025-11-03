Voicerecorder server files (cwd-based)
=====================================

Files added:
 - storage.py
 - ws_voicerecorder.py
 - audio_assembler.py
 - whisper_client.py

Placement:
 - Put these files into the 'server/' directory alongside your existing main.py and api_testserver.py.

Important notes:
 - These modules intentionally rely on os.getcwd() as the primary base path for storage:
     BASE = <cwd>/data/voicerecorder
   You can override by setting environment variable VOICE_BASE_DIR to point to either:
     - the exact voicerecorder folder (e.g. /home/render/project/data/voicerecorder)
     - or the parent data folder (e.g. /home/render/project/data) — storage will normalize.

 - Ensure ffmpeg is installed on the host and available in PATH:
     ffmpeg -version

 - Ensure OPENAI_API_KEY is set in environment variables (Render -> Environment):
     OPENAI_API_KEY=sk-...

 - Ensure your main.py mounts '/data' STATIC to serve files under <cwd>/data.
   (If you used the updated main.py I provided earlier, it mounts '/data' automatically.)

Dependencies:
 - Add to requirements (append):
   numpy>=1.25
   openai>=1.0.0
   pydub>=0.25.1
   aiofiles>=23.1.0

Testing:
 1. Start server (uvicorn server.main:app --host 0.0.0.0 --port 8000)
 2. Check whoami route if present or run:
    curl http://localhost:8000/.static-check
 3. Visit voicerecorder page and press START (client should attempt websocket to /ws/voicerecorder).
 4. On STOP the server will assemble files under:
    <cwd>/data/voicerecorder/<session_id>/final/<...>.mp3
 5. Accessible at:
    http://<host>/data/voicerecorder/<session_id>/final/<file>.mp3

If anything fails (permission, ffmpeg missing, or OpenAI errors) logs will show details.
