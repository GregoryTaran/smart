# server/storage.py
# Storage helpers. Primary base path is derived from os.getcwd() (as requested).
# Optional override via VOICE_BASE_DIR env var.
import os
from pathlib import Path

def _compute_base():
    # 1) explicit env override (highest priority)
    env = os.environ.get("VOICE_BASE_DIR")
    if env:
        p = Path(env).resolve()
        # if user gave path to voicerecorder subfolder or to data parent, normalize
        if p.name == "voicerecorder":
            base = p
        else:
            # assume user gave the parent 'data' dir or project root: ensure /data/voicerecorder exists
            base = (p / "voicerecorder").resolve()
        return base

    # 2) use process cwd (Render: reliable)
    try:
        cwd = Path(os.getcwd()).resolve()
        base = (cwd / "data" / "voicerecorder").resolve()
        return base
    except Exception:
        pass

    # 3) fallback to file-relative (last resort)
    return Path(__file__).resolve().parents[1] / "data" / "voicerecorder"

BASE_PATH: Path = _compute_base()
# ensure existence
BASE_PATH.mkdir(parents=True, exist_ok=True)

def ensure_session_parts_dir(session_id: str) -> str:
    """Returns path to {BASE}/{session_id}/parts (creates)."""
    p = BASE_PATH / session_id / "parts"
    p.mkdir(parents=True, exist_ok=True)
    return str(p)

def ensure_session_final_dir(session_id: str) -> str:
    """Returns path to {BASE}/{session_id}/final (creates)."""
    p = BASE_PATH / session_id / "final"
    p.mkdir(parents=True, exist_ok=True)
    return str(p)

def public_url_for_file(fullpath: str) -> str:
    """
    Map absolute file path under BASE_PATH to public URL path.
    We serve BASE parent (data) at '/data' in main.py, so:
      BASE_PATH = <cwd>/data/voicerecorder
      public URL -> /data/voicerecorder/<relpath>
    """
    try:
        base = str(BASE_PATH)
        fp = os.path.abspath(fullpath)
        if fp.startswith(base):
            rel = os.path.relpath(fp, base)
            return f"/data/voicerecorder/{rel.replace(os.path.sep, '/')}"
    except Exception:
        pass
    # fallback: return basename under data path
    return "/data/voicerecorder/" + os.path.basename(fullpath)
