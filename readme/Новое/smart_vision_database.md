
# SMART VISION — Структура базы данных

## 1. `smart_users` — Пользователи

Хранит всех пользователей системы, включая AI.

| Поле | Тип | Описание |
|------|------|----------|
| id | uuid | ID пользователя |
| email | text | Email |
| name | text | Имя |
| password | text | Старое поле |
| password_hash | text | Хэш пароля |
| level | int | Уровень |
| role | text | user / admin / ai |
| created_at | timestamp | Когда создан |
| updated_at | timestamp | Когда обновлён |

---

## 2. `smart_sessions` — Сессии

Хранит токены авторизации.

| Поле | Тип | Описание |
|------|------|----------|
| id | uuid | ID сессии |
| user_id | uuid | Пользователь |
| token | text | Токен |
| created_at | timestamp | Создана |
| expires_at | timestamp | Истекает |
| last_used_at | timestamp | Последний доступ |
| user_agent | text | Браузер |

---

## 3. `visions` — Визии

Документ/проект, над которым работают участники.

| Поле | Тип | Описание |
|------|------|----------|
| id | uuid | ID визии |
| owner_id | uuid | Владелец |
| title | text | Название |
| description | text | Описание |
| created_at | timestamp | Когда создана |
| updated_at | timestamp | Когда обновлена |
| archived | boolean | Архивирована? |

---

## 4. `vision_participants` — Участники

Определяет, кто имеет доступ к визии.

| Поле | Тип | Описание |
|------|------|----------|
| vision_id | uuid | Визия |
| user_id | uuid | Участник |
| role | text | owner / editor / ai |
| added_at | timestamp | Когда добавлен |

---

## 5. `vision_steps` — Шаги визии

История взаимодействия пользователя и AI.

| Поле | Тип | Описание |
|------|------|----------|
| id | bigint | Номер шага |
| vision_id | uuid | Визия |
| user_id | uuid | Автор шага |
| user_text | text | Текст пользователя |
| ai_text | text | Ответ AI |
| created_at | timestamp | Когда создан |

---

## Главное в трёх строках:

```
smart_users — пользователи
visions — визии (проекты)
vision_participants — участники
vision_steps — история шагов
smart_sessions — сессии
```
