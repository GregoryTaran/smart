
# SMART VISION — AUTH SPEC v1
Полная спецификация новой системы идентификации и сессий SMART VISION  
Автор: Greg & Bro  
Версия: 1.0  
Дата: 2025

---

## 0. Главная идея системы

Полностью удалена старая модель авторизации:
- localStorage
- window.SVID
- набор отдельных скриптов
- разные источники данных
- неявная логика

Теперь система построена на трёх фундаментальных принципах:

### 1) Backend = единственный источник правды  
Только сервер определяет:
- кто пользователь,
- залогинен ли он,
- его уровень,
- его разрешения.

### 2) На клиенте — единый bootstrap  
В `<head>` каждой страницы подключён скрипт, который:
1. делает `GET /api/auth/session`;
2. кладёт результат в `window.SV_AUTH`;
3. вызывает глобальное событие `sv:auth-ready`.

### 3) Все модули фронта используют только `window.SV_AUTH`  
Топбар, меню, страницы, футер — всё построено вокруг одного объекта:
```
window.SV_AUTH = {
  isAuthenticated: Boolean,
  userId: String | null,
  level: Number,
  levelCode: "guest" | "user" | "paid" | "super",
  email: String | null,
  displayName: String | null,
  loaded: Boolean
}
```

---

## 1. Структура БД (Supabase)

### 1.1. Таблица `users`

Используем таблицу `public.users`, но структура стандартизирована:

| Поле | Тип | Значение |
|------|------|----------|
| user_id | UUID PK | Идентификатор |
| email | TEXT UNIQUE | Уникальный email |
| password | TEXT | Пароль в открытом виде (временно) |
| password_hash | TEXT | Место для bcrypt в будущем |
| display_name | TEXT | Имя пользователя |
| level | SMALLINT | Уровень доступа (1=guest,2=user) |
| created_at | TIMESTAMPTZ | Дата регистрации |

### Правила:
- email уникальный (UNIQUE).
- password хранится пока что в открытом виде.
- В будущем можно начать писать хэш в password_hash, не ломая систему.

---

## 1.2. Таблица `auth_sessions`

Полностью новая таблица:

```
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  session_id   UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip_address   INET,
  user_agent   TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  session_data JSONB
);
```

Использование:
- Каждая запись — отдельная сессия.
- session_id хранится в HttpOnly-cookie `sv_session`.
- Сессии могут быть деактивированы (`is_active=false`).

---

## 2. Backend (FastAPI)

### Основные компоненты:
- `main.py` — подключает middleware, роутеры.
- `svid.py` — полностью отвечает за авторизацию, регистрацию, сброс пароля, сессии.

---

## 2.1. Middleware `auth_middleware`

Выполняется на **каждом** запросе.

Алгоритм:

1. Прочитать куку `sv_session`.
2. Если нет → гость.
3. Если есть:
   - найти сессию в `auth_sessions`;
   - проверить `is_active=true` и `expires_at > now`;
   - подгрузить пользователя из `users`;
   - собрать объект:

```
request.state.auth = {
  is_authenticated: true,
  user_id: ...,
  level: ...,
  level_code: ...,
  email: ...,
  display_name: ...
}
```

4. Если где-то ошибка — безопасно откатываемся к гостю.
5. last_seen_at обновляется автоматически.

---

## 2.2. Основные эндпоинты `/api/auth/...`

### POST `/api/auth/register`
Создаёт пользователя.
Поля:
- name
- email
- password (plain text)

Результат:
```
{ "ok": true, "user_id": "uuid" }
```

---

### POST `/api/auth/login`
Проверяет email + password.

Если успешно:
- создаёт запись в `auth_sessions`,
- ставит HttpOnly-cookie `sv_session`.

Результат:
```
{ "ok": true }
```

---

### POST `/api/auth/logout`
- Деактивирует текущую сессию.
- Удаляет куку.

Результат:
```
{ "ok": true }
```

---

### POST `/api/auth/reset`
Генерирует новый пароль и записывает его в `users.password`.

Результат:
```
{
  "ok": true,
  "new_password": "Xy29Ab77R"
}
```

---

### GET `/api/auth/session`
Возвращает объект состояния для фронта:

```
{
  "is_authenticated": true/false,
  "user_id": "...",
  "level": 1/2/3,
  "level_code": "...",
  "email": "...",
  "display_name": "...",
}
```

---

## 3. Frontend — Bootstrap в `<head>`

На каждой странице находится глобальный скрипт:

1. делает `fetch('/api/auth/session')`;
2. помещает данные в `window.SV_AUTH`;
3. запускает `sv:auth-ready`.

Этот скрипт даёт состояние ВСЕМ модулям.

---

## 4. Frontend — topbar.module.js

Отвечает за:
- верхнюю полосу,
- кнопку выхода,
- пункты меню по уровню доступа,
- загрузку фрагмента `menu.html`,
- запись «level N» в правом углу.

Основные механизмы:
- слушает событие `sv:auth-ready`;
- берёт уровень из `window.SV_AUTH.level`;
- включает/выключает пункты меню в зависимости от разрешений;
- вызывает `/api/auth/logout`.

---

## 5. Frontend — footer.js (информер)

Всегда создаёт:

```
<footer id="footer">
  <div class="footer-inner">
    <div class="card" id="svFooterInfo">...</div>
  </div>
</footer>
```

Показывает:
- уровень,
- user_id,
- email,
- статус авторизации,
- levelCode.

Обновляется на:
- `sv:auth-ready`,
- `pageshow`,
- `sv:logout`.

---

## 6. Frontend — login.js / login.html

Полностью переписан под новый backend.

### Поддерживает 3 состояния:
- регистрация,
- вход,
- сброс.

### Работает с 3 эндпоинтами:
- `/api/auth/register`
- `/api/auth/login`
- `/api/auth/reset`

### Поведение:
- после логина → редирект на index.html
- после регистрации → переключение на login
- отрисовка ошибок сервера
- генерация нового пароля при сбросе

---

## 7. Как подключать новые страницы и модули

### Для любой новой страницы нужно:

1. Вставить в `<head>` bootstrap авторизации.
2. Подключить:
   - topbar.module.js
   - footer.js
3. В JS-файле страницы:

```
document.addEventListener('sv:auth-ready', (event) => {
  const auth = event.detail;
  if (!auth.isAuthenticated) {
    location.replace('login/login.html');
    return;
  }
  // тут загружаем данные для авторизованного пользователя
});
```

---

## 8. Как backend-роуты используют авторизацию

Любой маршрут FastAPI теперь может:

```
auth = request.state.auth
user = request.state.user
```

Пример проверки доступа:

```python
if not auth["is_authenticated"] or auth["level"] < 2:
    raise HTTPException(401, "Not authorized")
```

---

## 9. Будущее расширение системы

Система уже готова к расширению:

- Переключение на bcrypt — просто заменить проверку пароля в login.
- Мульти-устройства — уже работают через auth_sessions.
- Роли/группы — можно вынести в отдельную таблицу.
- Увеличение TTL сессии — одна переменная.
- "Remember me" — можно добавить отдельную куку.

---

## 10. Финальная структура проекта

```
smart/
  index.html
  login/login.html
  js/footer.js
  js/topbar.module.js
  (bootstrap-auth в <head>)

server/
  main.py
  svid/
    svid.py  <-- полностью новый модуль авторизации
```

---

## 11. Резюме

Это первая полноценная, масштабируемая, безопасная и понятная версия системы авторизации SMART VISION:

- Сессии через `auth_sessions`
- HttpOnly-cookie
- Уровни доступа
- Универсальный bootstrap
- Единый объект `window.SV_AUTH`
- Стандартизированные обработчики `/api/auth/...`
- Изолированный модуль `svid.py`
- Горизонтальная совместимость с любыми модулями

С этой системой можно уверенно строить следующие функции:
- Личный кабинет
- Платные уровни
- Права на проекты
- Команды / группы
- Расширенные роли
- Работа в многостраничном интерфейсе
