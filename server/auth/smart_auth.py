from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
import bcrypt
import secrets
import asyncpg

router = APIRouter()


# ============================================================
# Подключение к базе (Supabase PostgreSQL через connection URI)
# ============================================================

# !!! ВАЖНО: впиши сюда свой connection string !!!
DB_CONN = "postgresql://postgres:password@host:5432/postgres"


async def db():
    return await asyncpg.connect(DB_CONN)


# ============================================================
# МОДЕЛИ
# ============================================================

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ============================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================

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


# ============================================================
#                      REGISTER
# ============================================================

@router.post("/register")
async def register(req: RegisterRequest):

    conn = await db()

    # Проверяем существование email
    user = await conn.fetchrow(
        "SELECT id FROM smart_users WHERE email = $1",
        req.email
    )

    if user:
        await conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")

    # Создаём запись
    password_hash = make_hash(req.password)

    new_user = await conn.fetchrow(
        """
        INSERT INTO smart_users (email, name, password, password_hash, level)
        VALUES ($1, $2, $3, $4, 2)
        RETURNING id, email, name, level
        """,
        req.email, req.name, req.password, password_hash
    )

    await conn.close()

    return {"ok": True, "user": dict(new_user)}


# ============================================================
#                          LOGIN
# ============================================================

@router.post("/login")
async def login(req: LoginRequest):

    conn = await db()

    # Ищем юзера
    user = await conn.fetchrow(
        "SELECT * FROM smart_users WHERE email = $1 LIMIT 1",
        req.email
    )

    if not user:
        await conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Проверяем пароль
    if not check_hash(req.password, user["password_hash"]):
        await conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Создаём сессию
    token = generate_token()
    expires = expire_time()

    await conn.execute(
        """
        INSERT INTO smart_sessions (user_id, token, expires_at, user_agent, last_used_at)
        VALUES ($1, $2, $3, $4, now())
        """,
        user["id"], token, expires, "browser"
    )

    await conn.close()

    # Кладём в cookie
    resp = JSONResponse({"ok": True, "user_id": str(user["id"])})

    resp.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * SESSION_LIFETIME_DAYS,
        secure=False  # на сервере можешь поставить True
    )
    return resp


# ============================================================
#                          ME
# ============================================================

@router.get("/me")
async def me(request: Request):

    token = request.cookies.get(SESSION_COOKIE)

    if not token:
        return {"loggedIn": False, "level": 1, "user": None}

    conn = await db()

    # Ищем сессию
    session = await conn.fetchrow(
        """
        SELECT * FROM smart_sessions 
        WHERE token = $1 AND expires_at > now()
        LIMIT 1
        """,
        token
    )

    if not session:
        await conn.close()
        return {"loggedIn": False, "level": 1, "user": None}

    # Обновляем last_used_at
    await conn.execute(
        "UPDATE smart_sessions SET last_used_at = now() WHERE id = $1",
        session["id"]
    )

    # Ищем пользователя
    user = await conn.fetchrow(
        "SELECT id, email, name, level FROM smart_users WHERE id = $1",
        session["user_id"]
    )

    await conn.close()

    return {
        "loggedIn": True,
        "level": user["level"],
        "user": dict(user)
    }


# ============================================================
#                         LOGOUT
# ============================================================

@router.post("/logout")
async def logout(request: Request):

    token = request.cookies.get(SESSION_COOKIE)

    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)

    if not token:
        return resp

    conn = await db()

    await conn.execute(
        "DELETE FROM smart_sessions WHERE token = $1",
        token
    )

    await conn.close()

    return resp
