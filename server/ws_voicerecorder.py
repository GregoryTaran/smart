# server/ws_voicerecorder.py
# WebSocket router for the Voicerecorder microservice.
# Protocol:
#  - text: { "type":"start", "session_id":..., "sample_rate":..., "channels":..., "format":"float32" }
#  - text: { "type":"chunk_meta", "seq":..., "duration_ms":..., "bytes": N }
#  - binary: raw audio bytes (Float32Buffer)
#  - text: { "type":"stop", "session_id":... }
#
# On STOP we spawn a background async task to assemble/convert/transcribe so the WS event loop isn't blocked.

import os
import json
import uuid
import logging
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Optional
from pathlib import Path
import time

# local helpers (must be in server/)
import storage
import audio_assembler
import whisper_client

log = logging.getLogger("ws_voicerecorder")
router = APIRouter()


async def _process_session_async(session_id: str, parts_dir: str, sample_rate: int, channels: int, ws: WebSocket):
    """
    Assemble parts -> wav -> mp3 -> transcribe. Runs blocking parts in thread via asyncio.to_thread.
    Attempts to send result back on the provided WebSocket if it's still open.
    """
    try:
        final_dir = storage.ensure_session_final_dir(session_id)
        base = f"{session_id}__{int(time.time())}__{uuid.uuid4().hex[:6]}"
        out_wav = str(Path(final_dir) / (base + ".wav"))
        out_mp3 = str(Path(final_dir) / (base + ".mp3"))

        log.info("[%s] processing task started (parts: %s) -> wav=%s", session_id, parts_dir, out_wav)

        # assemble wav (blocking) in thread
        await asyncio.to_thread(audio_assembler.assemble_wav_from_parts, str(Path(parts_dir).parent), out_wav, sample_rate, channels)

        # convert to mp3 (uses ffmpeg via subprocess) also blocking
        await asyncio.to_thread(audio_assembler.convert_wav_to_mp3, out_wav, out_mp3)

        # transcribe (blocking network IO) in thread
        transcript = await asyncio.to_thread(whisper_client.transcribe_with_openai, out_mp3)

        mp3_url = storage.public_url_for_file(out_mp3)
        res = {"type": "result", "mp3_url": mp3_url, "transcript": transcript or ""}

        # try to send result back if client still connected
        try:
            if ws.client_state == WebSocket.STATE_CONNECTED and ws.application_state == WebSocket.STATE_CONNECTED:
                await ws.send_text(json.dumps(res))
            else:
                # If ws closed, just log; client can poll or fetch file by URL
                log.info("[%s] ws not connected to deliver result (client disconnected). mp3 at %s", session_id, out_mp3)
        except Exception as e:
            log.exception("[%s] failed to send result over ws: %s", session_id, e)

        log.info("[%s] processing finished: mp3=%s", session_id, out_mp3)
    except Exception as e:
        log.exception("background processing failed for session %s: %s", session_id, e)
        # attempt to inform client about error
        try:
            await ws.send_text(json.dumps({"type": "error", "message": f"processing failed: {e}"}))
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
            # msg is dict that may contain 'text' or 'bytes'
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
                    # expect next frame to be binary containing the float32 buffer
                    bin_msg = await ws.receive()
                    if 'bytes' in bin_msg and bin_msg['bytes']:
                        raw = bin_msg['bytes']
                        # write raw bytes to parts dir with seq
                        try:
                            fname = Path(parts_dir) / f"part_{seq:06d}.raw"
                            with open(fname, "wb") as f:
                                f.write(raw)
                            log.info("[%s] saved part %s (%d bytes)", session_id, fname.name, len(raw))
                        except Exception as e:
                            log.exception("[%s] failed to save part %s: %s", session_id, seq, e)
                            await ws.send_text(json.dumps({"type": "error", "message": f"save part failed: {e}"}))
                    else:
                        log.warning("[%s] expected binary after chunk_meta but got none", session_id)
                elif mtype == "stop":
                    if not session_id:
                        await ws.send_text(json.dumps({"type": "error", "message": "no active session to stop"}))
                        continue

                    # Immediately inform client that processing will start and spawn a background task
                    try:
                        await ws.send_text(json.dumps({"type": "processing", "message": "assembling and transcribing"}))
                    except Exception:
                        pass

                    # session_dir is parent of parts_dir
                    session_dir = str(Path(parts_dir).parent)
                    # create background task to avoid blocking the websocket event loop
                    asyncio.create_task(_process_session_async(session_id, session_dir, sample_rate, channels, ws))
                else:
                    await ws.send_text(json.dumps({"type": "info", "message": "unknown control"}))
            elif 'bytes' in msg and msg['bytes'] is not None:
                # binary frame that arrived without preceding meta — ignore or log
                log.debug("binary frame without meta (ignored) size=%d", len(msg['bytes']))
            else:
                # small yield to avoid tight loop
                await asyncio.sleep(0.01)
    except WebSocketDisconnect:
        log.info("client disconnected (session=%s)", session_id)
    except Exception:
        log.exception("unexpected error in ws_voicerecorder")
        try:
            await ws.close()
        except Exception:
            pass
