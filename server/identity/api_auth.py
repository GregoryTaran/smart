# server/identity/api_auth.py
from fastapi import APIRouter, Request, Response, HTTPException
from fastapi.responses import JSONResponse
import httpx, os

auth_router = APIRouter()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

# --------------- LOGIN ---------------
@auth_router.post("/login")
async def login(request: Request, response: Response):
    body = await request.json()
    email = body.get("email")
    password = body.get("password")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email и пароль обязательны")

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )

    if r.status_code != 200:
        detail = r.json().get("error_description", "Ошибка входа")
        raise HTTPException(status_code=400, detail=detail)

    data = r.json()
    access_token = data["access_token"]
    refresh_token = data["refresh_token"]

    # HttpOnly куки (безопасно)
    response = JSONResponse({"redirect": "/"})
    response.set_cookie("sb-access-token", access_token, httponly=True, samesite="lax")
    response.set_cookie("sb-refresh-token", refresh_token, httponly=True, samesite="lax")
    return response


# --------------- REGISTER ---------------
@auth_router.post("/register")
async def register(request: Request, response: Response):
    body = await request.json()
    email = body.get("email")
    password = body.get("password")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email и пароль обязательны")

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )

    if r.status_code not in (200, 201):
        detail = r.json().get("msg", "Ошибка регистрации")
        raise HTTPException(status_code=400, detail=detail)

    return JSONResponse({"redirect": "/"})
