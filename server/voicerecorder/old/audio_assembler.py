# server/audio_assembler.py
"""
Assemble raw Float32 parts (and associated .meta.json) into a WAV file,
then convert WAV to MP3 using ffmpeg.

Expect parts in:
  <session_dir>/parts/part_000000.raw
  <session_dir>/parts/part_000000.meta.json

Meta JSON fields used:
  - sample_rate
  - channels
  - chunk_samples
  - valid_samples

This module uses numpy + wave and external ffmpeg binary (via subprocess).
"""

import os
import json
import glob
import wave
import shutil
import subprocess
import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("audio_assembler")


def assemble_wav_from_parts(session_dir: str, out_wav: str, default_sample_rate: int = 48000, channels: int = 1):
    """
    Read parts/*.raw and parts/*.meta.json, construct a single WAV file (16-bit PCM).
    """
    parts_dir = Path(session_dir) / "parts"
    pattern = str(parts_dir / "part_*.raw")
    files = sorted(glob.glob(pattern))
    if not files:
        raise RuntimeError("No parts found to assemble")

    sample_rate = default_sample_rate
    out_chunks = []

    for p in files:
        meta_path = Path(str(p).replace(".raw", ".meta.json"))
        # read raw bytes
        with open(p, "rb") as f:
            raw = f.read()
        # ensure length divisible by 4 (float32)
        if len(raw) % 4 != 0:
            log.warning("raw part %s length %d not divisible by 4, trimming", p, len(raw))
            raw = raw[: len(raw) - (len(raw) % 4)]
        floats = np.frombuffer(raw, dtype=np.float32)
        valid = len(floats)
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as fm:
                    meta = json.load(fm)
                    valid = int(meta.get("valid_samples", valid))
                    sample_rate = int(meta.get("sample_rate", sample_rate))
            except Exception:
                log.exception("failed to read meta %s", meta_path)
        # clip by valid
        if valid < 0 or valid > len(floats):
            log.warning("invalid valid_samples %s for part %s, using full length", valid, p)
            valid = len(floats)
        out_chunks.append(floats[:valid])

    if not out_chunks:
        raise RuntimeError("No samples to write")

    # concatenate all float arrays
    if len(out_chunks) == 1:
        out = out_chunks[0]
    else:
        out = np.concatenate(out_chunks)

    # convert float32 (-1..1) to int16 PCM
    # guard NaNs/Infs
    out = np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)
    int16 = np.clip((out * 32767.0), -32768, 32767).astype(np.int16)

    # write WAV (16-bit PCM)
    out_wav_path = Path(out_wav)
    out_wav_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_wav_path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(int16.tobytes())

    log.info("WAV written: %s (samples=%d sr=%d)", out_wav, int16.shape[0], sample_rate)
    return out_wav


def convert_wav_to_mp3(in_wav: str, out_mp3: str, bitrate: str = "128k"):
    """
    Convert WAV to MP3 using ffmpeg. Raise if ffmpeg not available or conversion fails.
    """
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise RuntimeError("ffmpeg not found in PATH; required to convert to mp3")

    out_dir = Path(out_mp3).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg_path,
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(in_wav),
        "-acodec", "libmp3lame",
        "-ab", bitrate,
        "-ac", "1",  # mono
        str(out_mp3),
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        log.exception("ffmpeg conversion failed: %s", e)
        raise

    log.info("MP3 written: %s", out_mp3)
    return out_mp3
