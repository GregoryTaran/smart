# server/whisper_client.py
# Updated to support openai>=1.0.0 (new API object) while keeping robust logging.
import os
import logging

try:
    import openai
except Exception:
    openai = None

log = logging.getLogger("whisper_client")
openai_api_key = os.environ.get("OPENAI_API_KEY")

if openai and openai_api_key:
    # If using the v1-style OpenAI client (openai.OpenAI), we prefer to set api key on the client.
    try:
        # some openai versions expect environment variable only; providing it explicitly is safe
        if hasattr(openai, "OpenAI"):
            # create client instance for new SDK
            try:
                client = openai.OpenAI(api_key=openai_api_key)
            except TypeError:
                # older wrappers may not accept api_key param; fall back to env var usage
                client = openai.OpenAI()
        else:
            client = None
    except Exception as e:
        log.debug("openai.OpenAI client creation failed: %s", e)
        client = None
else:
    client = None
    if not openai:
        log.warning("openai package not available; transcription disabled")
    elif not openai_api_key:
        log.warning("OPENAI_API_KEY not set; transcription will fail until provided")

def transcribe_with_openai(audio_path: str, model: str = "whisper-1") -> str:
    """
    Transcribe the given audio file using OpenAI API.
    Supports new openai.OpenAI client (v1+) and logs helpful errors.
    Returns transcript text or empty string on failure.
    """
    if not os.path.exists(audio_path):
        log.warning("transcribe: file not found: %s", audio_path)
        return ""

    # 1) Try new client if available (recommended)
    if client is not None:
        try:
            with open(audio_path, "rb") as fh:
                # new SDK: client.audio.transcriptions.create(...)
                resp = client.audio.transcriptions.create(model=model, file=fh)
            # resp likely a dict-like with 'text'
            if isinstance(resp, dict):
                return resp.get("text", "") or ""
            # attempt attribute access if object-like
            return getattr(resp, "text", "") or ""
        except Exception as e:
            log.exception("openai v1 client transcription failed: %s", e)
            # fall through to older-style attempts (below) if possible

    # 2) Try old-style openai API (for older openai package versions)
    if openai is not None:
        try:
            # legacy style (pre-1.0) — might not exist in newer installs
            # keep this in a try block because in >=1.0 this symbol is removed and raises.
            try:
                res = openai.Audio.transcribe(model=model, file=open(audio_path, "rb"))
                if isinstance(res, dict):
                    return res.get("text", "") or ""
                return getattr(res, "text", "") or ""
            except Exception:
                # older fallback: openai.Audio.transcriptions.create
                resp = openai.Audio.transcriptions.create(model=model, file=open(audio_path, "rb"))
                if isinstance(resp, dict):
                    return resp.get("text", "") or ""
                return getattr(resp, "text", "") or ""
        except Exception as e2:
            # If we hit the removed API error, log the clear message
            log.exception("fallback openai call failed: %s", e2)

    # 3) All attempts failed
    log.error("Transcription unavailable: OpenAI client call failed or OPENAI_API_KEY missing.")
    return ""
