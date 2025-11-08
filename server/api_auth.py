# server/api_auth.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from pathlib import Path
import json, os, uuid, datetime

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

class RegisterBody(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginBody(BaseModel):
    email: EmailStr
    password: str

@router.post("/register")
def register(body: RegisterBody):
    if not body.name.strip() or len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Заполните имя и пароль от 8 символов")

    users = _load_users()
    if any(u.get("email") == body.email.lower() for u in users):
        raise HTTPException(status_code=409, detail="Такой email уже зарегистрирован")

    user = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "email": body.email.lower(),
        # Временно храним пароль в открытую (как договорились — «ничего сложного»)
        "password": body.password,
        "createdAt": datetime.datetime.utcnow().isoformat() + "Z"
    }
    users.append(user)
    _save_users(users)
    return {"ok": True, "redirect": "/"}

@router.post("/login")
def login(body: LoginBody):
    users = _load_users()
    ok = next((u for u in users if u.get("email")==body.email.lower() and u.get("password")==body.password), None)
    if not ok:
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    # Без сессий/JWT — максимально просто: фронт получит redirect
    return {"ok": True, "redirect": "/"}
