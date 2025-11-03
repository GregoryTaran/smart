# server/audio_assembler.py
# assemble_wav_from_parts(session_dir, out_wav) and convert_wav_to_mp3(in_wav, out_mp3)
import os
import glob
import wave
import numpy as np
import subprocess
from typing import Optional

def _float32_bytes_to_int16_bytes(b: bytes) -> bytes:
    # Interpret incoming bytes as float32 PCM and convert to int16 bytes
    arr = np.frombuffer(b, dtype=np.float32)
    # sanitize
    arr = np.nan_to_num(arr)
    arr = np.clip(arr, -1.0, 1.0)
    int16 = (arr * 32767.0).astype(np.int16)
    return int16.tobytes()

def assemble_wav_from_parts(session_dir: str, out_wav_path: str, sample_rate: int = 48000, channels: int = 1) -> str:
    """
    session_dir: path that contains 'parts' subfolder with part_*.raw Float32 binaries
    Writes a 16-bit PCM WAV file to out_wav_path.
    """
    parts_dir = os.path.join(session_dir, "parts")
    files = sorted(glob.glob(os.path.join(parts_dir, "part_*.raw")))
    if not files:
        raise RuntimeError("No parts found to assemble")
    os.makedirs(os.path.dirname(out_wav_path), exist_ok=True)
    with wave.open(out_wav_path, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        for fpath in files:
            with open(fpath, "rb") as fh:
                raw = fh.read()
                pcm_bytes = _float32_bytes_to_int16_bytes(raw)
                wf.writeframes(pcm_bytes)
    return out_wav_path

def convert_wav_to_mp3(in_wav: str, out_mp3: Optional[str] = None, bitrate: str = "128k") -> str:
    if out_mp3 is None:
        out_mp3 = in_wav.replace(".wav", ".mp3")
    # Use ffmpeg command; ensure ffmpeg in PATH
    cmd = ["ffmpeg", "-y", "-i", in_wav, "-vn", "-ar", "48000", "-ac", "1", "-b:a", bitrate, out_mp3]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return out_mp3
