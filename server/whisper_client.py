# server/whisper_client.py
# Minimal OpenAI wrapper for speech->text.
# Tries a couple of API shapes to be tolerant to different openai lib versions.
import os
import logging
import openai

log = logging.getLogger("whisper_client")
openai_api_key = os.environ.get("OPENAI_API_KEY")
if openai_api_key:
    openai.api_key = openai_api_key
else:
    log.warning("OPENAI_API_KEY not set; transcription will fail until provided")

def transcribe_with_openai(audio_path: str, model: str = "whisper-1") -> str:
    """
    Sends audio file to OpenAI whisper endpoint. Returns plain text (or empty string on failure).
    Uses modern openai.Audio.transcribe if available, otherwise falls back to older styles.
    """
    if not os.path.exists(audio_path):
        log.warning("transcribe: file not found: %s", audio_path)
        return ""
    try:
        # Modern style: openai.Audio.transcribe
        try:
            res = openai.Audio.transcribe(model=model, file=open(audio_path, "rb"))
            if isinstance(res, dict):
                return res.get("text", "") or ""
            return getattr(res, "text", "") or ""
        except Exception as e_mod:
            log.debug("modern openai call failed: %s", e_mod)
            # older fallback
            try:
                resp = openai.Audio.transcriptions.create(model=model, file=open(audio_path, "rb"))
                if isinstance(resp, dict):
                    return resp.get("text", "") or ""
                return getattr(resp, "text", "") or ""
            except Exception as e_fb:
                log.exception("fallback openai call failed: %s", e_fb)
                return ""
    except Exception as e:
        log.exception("transcription failed: %s", e)
        return ""
