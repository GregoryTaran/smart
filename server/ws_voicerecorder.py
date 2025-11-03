# server/ws_voicerecorder.py
"""
WebSocket endpoint for Voicerecorder microservice.

Protocol (client -> server):
- JSON text: {"type":"start", "session_id":..., "sample_rate":..., "channels":..., "chunk_samples": ...}
- JSON text: {"type":"chunk_meta", "seq":N, "sample_rate":..., "channels":..., "chunk_samples": ..., "valid_samples": ..., "timestamp": ...}
- Binary frame immediately after chunk_meta: ArrayBuffer (Float32) of length chunk_samples * 4 bytes
- JSON text: {"type":"stop", "session_id":...}

Server behavior:
- saves binary to server/data/voicerecorder/<session_id>/parts/part_{seq:06d}.raw
- saves meta to part_{seq:06d}.meta.json
- on stop: waits up to 3s for parts to appear, then spawns background task to assemble -> convert -> transcribe
- sends {"type":"processing"} immediately on stop, and {"type":"result", "mp3_url":..., "transcript":...} when done (if WS still connected)
"""

import os
import json
import uuid
import logging
import asyncio
import glob
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import storage
import audio_assembler
import whisper_client

log = logging.getLogger("ws_voicerecorder")
router = APIRouter()


async def _process_session_async(session_id: str, session_dir: str, sample_rate: int, channels: int, ws: WebSocket):
    """
    Background processing:
      - wait briefly for parts to settle
      - assemble WAV taking into account per-part meta (valid_samples)
      - convert WAV -> MP3 (ffmpeg)
      - transcribe MP3 via whisper_client
      - attempt to send result back via ws (best-effort)
    """
    try:
        parts_folder = os.path.join(session_dir, "parts")
        # small wait-loop to allow final parts to be written (race protection)
        waited = 0.0
        files = []
        while waited < 3.0:
            files = sorted(glob.glob(os.path.join(parts_folder, "part_*.raw")))
            if files:
                break
            await asyncio.sleep(0.15)
            waited += 0.15

        if not files:
            raise RuntimeError("No parts found to assemble")

        final_dir = storage.ensure_session_final_dir(session_id)
        base = f"{session_id}__{int(time.time())}__{uuid.uuid4().hex[:6]}"
        out_wav = str(Path(final_dir) / (base + ".wav"))
        out_mp3 = str(Path(final_dir) / (base + ".mp3"))

        log.info("[%s] processing: parts=%d -> wav=%s", session_id, len(files), out_wav)

        # assemble wav (blocking) in thread
        await asyncio.to_thread(audio_assembler.assemble_wav_from_parts, session_dir, out_wav, sample_rate, channels)
        log.info("[%s] assembled wav: %s", session_id, out_wav)

        # convert wav -> mp3
        await asyncio.to_thread(audio_assembler.convert_wav_to_mp3, out_wav, out_mp3)
        log.info("[%s] converted mp3: %s", session_id, out_mp3)

        # transcribe
        try:
            transcript = await asyncio.to_thread(whisper_client.transcribe_with_openai, out_mp3)
        except Exception as e:
            log.exception("[%s] transcription failed: %s", session_id, e)
            transcript = ""

        mp3_url = storage.public_url_for_file(out_mp3)
        result_payload = {"type": "result", "mp3_url": mp3_url, "transcript": transcript or ""}

        # best-effort send via websocket
        try:
            await ws.send_text(json.dumps(result_payload))
        except Exception:
            # ws may be closed; log and continue
            log.info("[%s] ws closed or failed to send result; mp3 at %s", session_id, out_mp3)

        log.info("[%s] processing finished successfully", session_id)
    except Exception as exc:
        log.exception("background processing failed for session %s: %s", session_id, exc)
        try:
            await ws.send_text(json.dumps({"type": "error", "message": f"processing failed: {exc}"}))
        except Exception:
            pass


@router.websocket("/ws/voicerecorder")
async def voicerecorder_ws(ws: WebSocket):
    await ws.accept()
    session_id: Optional[str] = None
    sample_rate = 48000
    channels = 1
    parts_dir = None

    try:
        while True:
            msg = await ws.receive()
            # msg: dict that may have 'text' or 'bytes'
            if 'text' in msg and msg['text'] is not None:
                try:
                    data = json.loads(msg['text'])
                except Exception:
                    await ws.send_text(json.dumps({"type": "error", "message": "invalid json"}))
                    continue

                mtype = data.get("type")
                if mtype == "start":
                    session_id = data.get("session_id") or f"sess_{uuid.uuid4().hex[:8]}"
                    sample_rate = int(data.get("sample_rate", sample_rate))
                    channels = int(data.get("channels", channels))
                    parts_dir = storage.ensure_session_parts_dir(session_id)
                    await ws.send_text(json.dumps({"type": "started", "session_id": session_id}))
                    log.info("[%s] started sr=%s ch=%s parts=%s", session_id, sample_rate, channels, parts_dir)

                elif mtype == "chunk_meta":
                    if not session_id:
                        await ws.send_text(json.dumps({"type": "error", "message": "no active session"}))
                        continue
                    seq = int(data.get("seq", 0))
                    chunk_samples = int(data.get("chunk_samples", 0))
                    valid_samples = int(data.get("valid_samples", chunk_samples))
                    # expect binary frame next
                    bin_msg = await ws.receive()
                    if 'bytes' in bin_msg and bin_msg['bytes']:
                        raw = bin_msg['bytes']
                        try:
                            fname_raw = Path(parts_dir) / f"part_{seq:06d}.raw"
                            fname_meta = Path(parts_dir) / f"part_{seq:06d}.meta.json"
                            # ensure dir
                            os.makedirs(parts_dir, exist_ok=True)
                            with open(fname_raw, "wb") as f:
                                f.write(raw)
                            meta_payload = {
                                "seq": seq,
                                "sample_rate": data.get("sample_rate", sample_rate),
                                "channels": data.get("channels", channels),
                                "chunk_samples": chunk_samples,
                                "valid_samples": valid_samples,
                                "timestamp": data.get("timestamp")
                            }
                            with open(fname_meta, "w", encoding="utf-8") as fm:
                                json.dump(meta_payload, fm, ensure_ascii=False)
                            log.info("[%s] saved part %s (chunk_samples=%d valid=%d bytes=%d)",
                                     session_id, fname_raw.name, chunk_samples, valid_samples, len(raw))
                        except Exception as e:
                            log.exception("[%s] failed to save part %s: %s", session_id, seq, e)
                            await ws.send_text(json.dumps({"type": "error", "message": f"save part failed: {e}"}))
                    else:
                        log.warning("[%s] expected binary after chunk_meta but got none", session_id)

                elif mtype == "stop":
                    if not session_id:
                        await ws.send_text(json.dumps({"type": "error", "message": "no active session to stop"}))
                        continue

                    # inform client and start background processing
                    try:
                        await ws.send_text(json.dumps({"type": "processing", "message": "assembling and transcribing"}))
                    except Exception:
                        pass

                    session_dir = str(Path(parts_dir).parent)
                    # spawn background task; don't await here
                    asyncio.create_task(_process_session_async(session_id, session_dir, sample_rate, channels, ws))

                else:
                    await ws.send_text(json.dumps({"type": "info", "message": "unknown control"}))

            elif 'bytes' in msg and msg['bytes'] is not None:
                # binary frame without preceding meta - ignore but log
                log.debug("binary frame without meta (ignored) size=%d", len(msg['bytes']))
            else:
                # yield
                await asyncio.sleep(0.01)

    except WebSocketDisconnect:
        log.info("client disconnected (session=%s)", session_id)
    except Exception:
        log.exception("unexpected error in ws_voicerecorder")
        try:
            await ws.close()
        except Exception:
            pass
