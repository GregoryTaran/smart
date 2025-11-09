# api_testserver.py
from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone
import time
import logging

log = logging.getLogger("api_testserver")

# NOTE: main.py подключает этот router с префиксом "/api/testserver",
# поэтому здесь НЕ указываем prefix в APIRouter.
router = APIRouter(tags=["testserver"])


@router.get("/ping")
def ping():
    """Простой ping — проверка живости"""
    return {"pong": True}


@router.get("/info")
def info():
    """Информация о модуле для быстрой проверки"""
    return {
        "service": "testserver",
        "status": "ok",
        "note": "Use GET /api/testserver/time to get server time"
    }


@router.get("/time")
def server_time():
    """
    Возвращает текущее время сервера в нескольких форматах:
      - server_time_utc       : ISO 8601 (с зоной UTC)
      - server_time_local     : локальное системное время в ISO (без зоны)
      - server_timestamp_ms   : unix timestamp в миллисекундах (удобно для frontend)
      - monotonic_ms          : монотонный счётчик (без сдвигов системного времени)
    """
    try:
        now_utc = datetime.now(timezone.utc)
        now_local = datetime.now()
        ts_ms = int(now_utc.timestamp() * 1000)
        monotonic_ms = int(time.monotonic() * 1000)
        return {
            "server_time_utc": now_utc.isoformat(),
            "server_time_local": now_local.isoformat(),
            "server_timestamp_ms": ts_ms,
            "monotonic_ms": monotonic_ms,
            "tz_note": "UTC returned as canonical time; local included for convenience"
        }
    except Exception as e:
        log.exception("Failed to produce server time")
        raise HTTPException(status_code=500, detail="Unable to produce server time")
