# server/api_auth.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
import json, os, uuid, datetime as dt

router = APIRouter(tags=["auth"])

DATA_DIR = Path(os.getcwd()).resolve() / "data"
USERS_FILE = DATA_DIR / "users.json"

def _ensure_storage():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not USERS_FILE.exists():
        USERS_FILE.write_text("[]", encoding="utf-8")

def _load_users():
    _ensure_storage()
    try:
        return json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []

def _save_users(users):
    _ensure_storage()
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")

def _bad_email(e: str) -> bool:
    """Простейшая проверка без зависимостей."""
    if not isinstance(e, str):
        return True
    e = e.strip()
    return (not e) or ("@" not in e) or ("." not in e) or (" " in e)

class RegisterBody(BaseModel):
    name: str
    email: str
    password: str

class LoginBody(BaseModel):
    email: str
    password: str

@router.post("/register")
def register(body: RegisterBody):
    name = (body.name or "").strip()
    email = (body.email or "").strip().lower()
    password = body.password or ""

    # Максимально простая валидация
    if not name or len(password) < 8 or _bad_email(email):
        raise HTTPException(status_code=400, detail="Заполните имя, корректный email и пароль от 8 символов")

    users = _load_users()
    if any(u.get("email") == email for u in users):
        raise HTTPException(status_code=409, detail="Такой email уже зарегистрирован")

    users.append({
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        # Внимание: пароль временно в открытом виде (по договорённости, пока MVP)
        "password": password,
        "createdAt": dt.datetime.utcnow().isoformat() + "Z",
    })
    _save_users(users)
    return {"ok": True, "redirect": "/"}

@router.post("/login")
def login(body: LoginBody):
    email = (body.email or "").strip().lower()
    password = body.password or ""
    if not email or not password:
        raise HTTPException(status_code=400, detail="Укажите email и пароль")

    users = _load_users()
    ok = next((u for u in users if u.get("email") == email and u.get("password") == password), None)
    if not ok:
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    # Никаких сессий/куки — фронт сам покажет «Выйти», редирект на корень
    return {"ok": True, "redirect": "/"}
