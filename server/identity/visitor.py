# server/identity/visitor.py
import os
import uuid
from typing import Optional, Dict, Any

import httpx
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is not set")
if not SERVICE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")

REST_URL = f"{SUPABASE_URL}/rest/v1"
HEADERS_JSON = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}
HEADERS_RETURN = dict(HEADERS_JSON, **{"Prefer": "return=representation"})

router = APIRouter(prefix="/identity", tags=["identity"])

class UTM(BaseModel):
    source: Optional[str] = None
    medium: Optional[str] = None
    campaign: Optional[str] = None
    term: Optional[str] = None
    content: Optional[str] = None

class VisitorIn(BaseModel):
    sv_vid: Optional[str] = Field(default=None)
    landing_url: Optional[str] = None
    referrer_host: Optional[str] = None
    utm: Optional[UTM] = None
    device_type: Optional[str] = Field(default=None, pattern="^(desktop|mobile|tablet)$")
    app_platform: Optional[str] = Field(default="browser", pattern="^(browser|pwa|native_app|webview)$")

async def get_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    client = request.client
    return client.host if client else "0.0.0.0"

async def supabase_select_visitor(visitor_id: uuid.UUID) -> Optional[Dict[str, Any]]:
    params = {"visitor_id": f"eq.{str(visitor_id)}", "limit": "1"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{REST_URL}/visitor", params=params, headers=HEADERS_JSON)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Supabase select error: {r.text}")
    rows = r.json()
    return rows[0] if rows else None

async def supabase_insert_visitor(payload: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(f"{REST_URL}/visitor", json=payload, headers=HEADERS_RETURN)
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Supabase insert error: {r.text}")
    rows = r.json()
    return rows[0] if rows else payload

@router.post("/visitor")
async def create_or_get_visitor(request: Request, body: VisitorIn):
    if body.sv_vid:
        try:
            vid = uuid.UUID(body.sv_vid)
        except ValueError:
            vid = None
        if vid:
            existing = await supabase_select_visitor(vid)
            if existing:
                return {"visitor_id": str(existing["visitor_id"]), "level": existing.get("level", 1), "created": False}

    new_vid = uuid.uuid4()
    ip_addr = await get_client_ip(request)

    utm = body.utm.dict() if body.utm else {}
    payload = {
        "visitor_id": str(new_vid),
        "level": 1,
        "landing_url": body.landing_url,
        "referrer_host": body.referrer_host,
        "utm_source": utm.get("source"),
        "utm_medium": utm.get("medium"),
        "utm_campaign": utm.get("campaign"),
        "utm_term": utm.get("term"),
        "utm_content": utm.get("content"),
        "device_type": body.device_type,
        "app_platform": body.app_platform or "browser",
        "ip_address": ip_addr,
    }

    row = await supabase_insert_visitor(payload)
    return {"visitor_id": str(row.get("visitor_id", new_vid)), "level": row.get("level", 1), "created": True}
