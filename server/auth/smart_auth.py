from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
import bcrypt
import secrets
import asyncpg
import os

router = APIRouter()

# ===============================
# БАЗА + ПУЛ
# ===============================

DB_CONN = os.getenv("DATABASE_URL")
pool = None


@router.on_event("startup")
async def startup():
    """
    Создаём пул соединений при старте ГЛАВНОГО приложения.
    """
    global pool
    print("🔌 Creating DB pool:", DB_CONN)

    pool = await asyncpg.create_pool(
        DB_CONN,
        min_size=1,
        max_size=5,
        command_timeout=5
    )


async def db():
    """Возвращаем пул."""
    return pool


# ===============================
# МОДЕЛИ
# ===============================

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr


# ===============================
# ВСПОМОГАТЕЛЬНЫЕ
# ===============================

SESSION_COOKIE = "smart_session"
SESSION_LIFETIME_DAYS = 7


def make_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_hash(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def generate_token() -> str:
    return secrets.token_hex(32)


def expire_time():
    return datetime.utcnow() + timedelta(days=SESSION_LIFETIME_DAYS)


# ===============================
# REGISTER
# ===============================

@router.post("/register")
async def register(req: RegisterRequest):

    # 👉 всегда храним email в нижнем регистре
    email = req.email.lower().strip()

    pool = await db()
    async with pool.acquire() as conn:

        user = await conn.fetchrow(
            "SELECT id FROM smart_users WHERE email = $1",
            email
        )
        if user:
            raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

        password_hash = make_hash(req.password)

        # ❗ НЕ храним открытый пароль, только hash
        new_user = await conn.fetchrow(
            """
            INSERT INTO smart_users (email, name, password_hash, level)
            VALUES ($1, $2, $3, 2)
            RETURNING id, email, name, level
            """,
            email, req.name, password_hash
        )

        return {"ok": True, "user": dict(new_user)}


# ===============================
# LOGIN
# ===============================

@router.post("/login")
async def login(req: LoginRequest):

    email = req.email.lower().strip()

    pool = await db()
    async with pool.acquire() as conn:

        user = await conn.fetchrow(
            "SELECT * FROM smart_users WHERE email = $1 LIMIT 1",
            email
        )

        if not user or not check_hash(req.password, user["password_hash"]):
            # Сообщение лаконичное, но понятное
            raise HTTPException(status_code=401, detail="Неверный email или пароль")

        token = generate_token()
        expires = expire_time()

        await conn.execute(
            """
            INSERT INTO smart_sessions (user_id, token, expires_at, user_agent, last_used_at)
            VALUES ($1, $2, $3, $4, now())
            """,
            user["id"], token, expires, "browser"
        )

        resp = JSONResponse({"ok": True, "user_id": str(user["id"])})
        resp.set_cookie(
            key=SESSION_COOKIE,
            value=token,
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 24 * SESSION_LIFETIME_DAYS,
            secure=True  # если ломает dev на http, можно сделать secure=USE_HTTPS_ENV
        )
        return resp


# ===============================
# ME
# ===============================

@router.get("/me")
async def me(request: Request):

    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return {"loggedIn": False, "level": 1, "user": None}

    pool = await db()
    async with pool.acquire() as conn:

        session = await conn.fetchrow(
            """
            SELECT * FROM smart_sessions
            WHERE token = $1 AND expires_at > now()
            LIMIT 1
            """,
            token
        )

        if not session:
            return {"loggedIn": False, "level": 1, "user": None}

        await conn.execute(
            "UPDATE smart_sessions SET last_used_at = now() WHERE id = $1",
            session["id"]
        )

        user = await conn.fetchrow(
            "SELECT id, email, name, level FROM smart_users WHERE id = $1",
            session["user_id"]
        )

        return {
            "loggedIn": True,
            "level": user["level"],
            "user": dict(user)
        }


# ===============================
# LOGOUT
# ===============================

@router.post("/logout")
async def logout(request: Request):

    token = request.cookies.get(SESSION_COOKIE)

    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)

    if not token:
        return resp

    pool = await db()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM smart_sessions WHERE token = $1",
            token
        )

    return resp


# ===============================
# RESET PASSWORD
# ===============================

@router.post("/reset")
async def reset_password(req: ResetPasswordRequest):

    email = req.email.lower().strip()

    pool = await db()
    async with pool.acquire() as conn:

        # Ищем пользователя
        user = await conn.fetchrow(
            "SELECT id FROM smart_users WHERE email = $1 LIMIT 1",
            email
        )

        if not user:
            raise HTTPException(status_code=404, detail="Пользователь с таким email не найден")

        # Генерируем новый пароль (6 шестнадцатеричных символов)
        new_pass = secrets.token_hex(3)  # Например: '3af9d1'

        # Хэшируем
        new_hash = make_hash(new_pass)

        # Обновляем только hash (и при желании чистим старое текстовое поле password)
        await conn.execute(
            "UPDATE smart_users SET password_hash = $1, password = NULL WHERE id = $2",
            new_hash,
            user["id"]
        )

        # Возвращаем новый пароль — фронт покажет его на странице
        return {
            "ok": True,
            "email": email,
            "new_password": new_pass
        }
