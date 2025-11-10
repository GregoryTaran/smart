# SERVER/identity/svid.py
from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
import uuid, httpx, os

router = APIRouter(prefix="/identity", tags=["identity"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
REST_URL = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

async def get_ip(req: Request):
    xff = req.headers.get("x-forwarded-for") or req.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else None

@router.post("/svid/init")
async def svid_init(req: Request):
    """Первый шаг — регистрация визитора в Supabase"""
    try:
        body = await req.json()
    except Exception:
        body = {}

    # собираем параметры
    visitor_id = str(uuid.uuid4())
    ip = await get_ip(req)
    ua = req.headers.get("user-agent", "")
    lang = req.headers.get("accept-language", "").split(",")[0]
    ref = req.headers.get("referer", "")
    now = datetime.now(timezone.utc).isoformat()

    data = {
        "visitor_id": visitor_id,
        "level": 1,
        "first_seen_at": now,
        "landing_url": body.get("landing_url") or req.url.path,
        "referrer_host": body.get("referrer_host") or ref,
        "utm_source": body.get("utm_source"),
        "utm_medium": body.get("utm_medium"),
        "utm_campaign": body.get("utm_campaign"),
        "utm_term": body.get("utm_term"),
        "utm_content": body.get("utm_content"),
        "device_type": body.get("device_type"),
        "device_class": body.get("device_class"),
        "os_name": body.get("os_name"),
        "browser_name": body.get("browser_name"),
        "screen_width": body.get("screen_width"),
        "screen_height": body.get("screen_height"),
        "touch_support": body.get("touch_support"),
        "app_platform": body.get("app_platform") or "browser",
        "geo_country": body.get("geo_country"),
        "geo_city": body.get("geo_city"),
        "timezone_guess": body.get("timezone_guess"),
        "ip_address": ip,
    }

    # отправляем в Supabase REST
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(f"{REST_URL}/visitor", json=data, headers=HEADERS)
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Supabase insert error: {r.text}")

    print(f"[SVID] NEW VISITOR {visitor_id} from {ip}")

    return {"visitor_id": visitor_id, "level": 1, "state": "visitor", "ts": now}
