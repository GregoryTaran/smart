# server/ws_voicerecorder.py
# WebSocket router for the Voicerecorder microservice.
# Protocol:
#  - text: { "type":"start", "session_id":..., "sample_rate":..., "channels":..., "format":"float32" }
#  - text: { "type":"chunk_meta", "seq":..., "duration_ms":..., "bytes": N }
#  - binary: raw audio bytes (Float32Buffer)
#  - text: { "type":"stop", "session_id":... }
#
# Exports: router (APIRouter)

import os
import json
import uuid
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Optional
from pathlib import Path
import time

# local helpers (same folder)
import storage
import audio_assembler
import whisper_client

log = logging.getLogger("ws_voicerecorder")
router = APIRouter()

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
                    await ws.send_text(json.dumps({"type":"error","message":"invalid json"}))
                    continue
                mtype = data.get("type")
                if mtype == "start":
                    session_id = data.get("session_id") or f"sess_{uuid.uuid4().hex[:8]}"
                    sample_rate = int(data.get("sample_rate", sample_rate))
                    channels = int(data.get("channels", channels))
                    parts_dir = storage.ensure_session_parts_dir(session_id)
                    await ws.send_text(json.dumps({"type":"started","session_id":session_id}))
                    log.info("[%s] started sr=%s ch=%s parts=%s", session_id, sample_rate, channels, parts_dir)
                elif mtype == "chunk_meta":
                    if not session_id:
                        await ws.send_text(json.dumps({"type":"error","message":"no active session"}))
                        continue
                    seq = int(data.get("seq", 0))
                    # receive next frame (binary)
                    bin_msg = await ws.receive()
                    if 'bytes' in bin_msg and bin_msg['bytes']:
                        raw = bin_msg['bytes']
                        # write raw bytes to parts dir
                        fname = Path(parts_dir) / f"part_{seq:06d}.raw"
                        # write synchronously (fast for small files)
                        with open(fname, "wb") as f:
                            f.write(raw)
                        log.debug("[%s] saved part %s (%d bytes)", session_id, fname.name, len(raw))
                    else:
                        log.warning("[%s] expected binary after chunk_meta but got none", session_id)
                elif mtype == "stop":
                    if not session_id:
                        await ws.send_text(json.dumps({"type":"error","message":"no active session to stop"}))
                        continue
                    # finalization runs synchronously (can be slow)
                    try:
                        final_dir = storage.ensure_session_final_dir(session_id)
                        # create unique base filename
                        base = f"{session_id}__{int(time.time())}__{uuid.uuid4().hex[:6]}"
                        out_wav = str(Path(final_dir) / (base + ".wav"))
                        out_mp3 = str(Path(final_dir) / (base + ".mp3"))
                        # session_dir is parent of parts_dir
                        session_dir = str(Path(parts_dir).parent)
                        audio_assembler.assemble_wav_from_parts(session_dir, out_wav, sample_rate=sample_rate, channels=channels)
                        audio_assembler.convert_wav_to_mp3(out_wav, out_mp3)
                        transcript = whisper_client.transcribe_with_openai(out_mp3)
                        mp3_url = storage.public_url_for_file(out_mp3)
                        res = {"type":"result", "mp3_url": mp3_url, "transcript": transcript or ""}
                        await ws.send_text(json.dumps(res))
                        log.info("[%s] processed: mp3=%s", session_id, out_mp3)
                    except Exception as e:
                        log.exception("processing failed for session %s", session_id)
                        await ws.send_text(json.dumps({"type":"error","message": str(e)}))
                else:
                    await ws.send_text(json.dumps({"type":"info","message":"unknown control"}))
            elif 'bytes' in msg and msg['bytes'] is not None:
                # binary frame that arrived without meta
                log.debug("binary frame without meta (ignored) size=%d", len(msg['bytes']))
            else:
                # fallback sleep tiny
                await asyncio.sleep(0.01)
    except WebSocketDisconnect:
        log.info("client disconnected (session=%s)", session_id)
    except Exception:
        log.exception("unexpected error in ws_voicerecorder")
        try:
            await ws.close()
        except Exception:
            pass
