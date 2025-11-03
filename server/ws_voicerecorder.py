# server/ws_voicerecorder.py
import os
import json
import uuid
import logging
import asyncio
import glob
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Optional
from pathlib import Path
import time

import storage
import audio_assembler
import whisper_client

log = logging.getLogger("ws_voicerecorder")
router = APIRouter()

async def _process_session_async(session_id: str, session_dir: str, sample_rate: int, channels: int, ws: WebSocket):
    """
    Assemble parts -> wav -> mp3 -> transcribe. Runs blocking parts in thread via asyncio.to_thread.
    Waits a small amount of time for parts to appear before failing.
    """
    try:
        parts_folder = os.path.join(session_dir, "parts")
        # wait up to 3 seconds for parts to appear (in short increments)
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

        log.info("[%s] processing task started (parts: %d) -> wav=%s", session_id, len(files), out_wav)

        # assemble wav (blocking) in thread
        await asyncio.to_thread(audio_assembler.assemble_wav_from_parts, session_dir, out_wav, sample_rate, channels)

        # convert to mp3 (blocking) in thread
        await asyncio.to_thread(audio_assembler.convert_wav_to_mp3, out_wav, out_mp3)

        # transcribe (blocking network IO) in thread
        transcript = await asyncio.to_thread(whisper_client.transcribe_with_openai, out_mp3)

        mp3_url = storage.public_url_for_file(out_mp3)
        res = {"type": "result", "mp3_url": mp3_url, "transcript": transcript or ""}

        try:
            if ws.client_state == WebSocket.STATE_CONNECTED and ws.application_state == WebSocket.STATE_CONNECTED:
                await ws.send_text(json.dumps(res))
            else:
                log.info("[%s] ws not connected to deliver result. mp3 at %s", session_id, out_mp3)
        except Exception as e:
            log.exception("[%s] failed to send result over ws: %s", session_id, e)

        log.info("[%s] processing finished: mp3=%s", session_id, out_mp3)
    except Exception as e:
        log.exception("background processing failed for session %s: %s", session_id, e)
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
                    bin_msg = await ws.receive()
                    if 'bytes' in bin_msg and bin_msg['bytes']:
                        raw = bin_msg['bytes']
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

                    try:
                        await ws.send_text(json.dumps({"type": "processing", "message": "assembling and transcribing"}))
                    except Exception:
                        pass

                    session_dir = str(Path(parts_dir).parent)
                    asyncio.create_task(_process_session_async(session_id, session_dir, sample_rate, channels, ws))
                else:
                    await ws.send_text(json.dumps({"type": "info", "message": "unknown control"}))
            elif 'bytes' in msg and msg['bytes'] is not None:
                log.debug("binary frame without meta (ignored) size=%d", len(msg['bytes']))
            else:
                await asyncio.sleep(0.01)
    except WebSocketDisconnect:
        log.info("client disconnected (session=%s)", session_id)
    except Exception:
        log.exception("unexpected error in ws_voicerecorder")
        try:
            await ws.close()
        except Exception:
            pass
