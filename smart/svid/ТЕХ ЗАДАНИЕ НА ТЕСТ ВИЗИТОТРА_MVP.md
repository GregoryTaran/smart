# SVID • VISITOR (MVP) — Техническое задание

## Цель
При открытии любой страницы (начинаем с `/smart/index.html`) у посетителя **однократно** создаётся запись в БД `visitor`, сервер выдаёт `visitor_id` и **уровень** (`level`), фронт сохраняет `visitor_id` локально и отображает **две строки**: `Visitor ID` и `Level`.

---

## Файлы проекта
- Фронтенд: `smart/svid/visitor.js`
- Бэкенд: `server/identity/visitor.py` (FastAPI, роут `POST /identity/visitor`)

---

## Хранилище на фронте
- Основное: `localStorage['sv_vid']`
- Если `sv_vid` уже есть — сервер **не вызываем**, на странице просто показываем сохранённый ID и уровень, который кэшируем в `localStorage['sv_level']`.
- Если `sv_level` нет (например, был только ID), можно один раз запросить сервер для получения уровня (`GET /identity/visitor/:id` — опционально, не входит в MVP). В MVP предполагаем, что ID и level приходят вместе при первом создании.

---

## Поведение фронта (`smart/svid/visitor.js`)
1. При загрузке страницы проверить `localStorage['sv_vid']`.
2. Если **нет** — собрать минимальные поля и вызвать `POST /identity/visitor`.
3. Получить ответ **содержит**:
   ```json
   { "visitor_id": "<uuid>", "level": 1, "created": true }
   ```
4. Сохранить в `localStorage`: `sv_vid = <uuid>`, `sv_level = 1`.
5. Отрисовать на странице два элемента (или одну область с двумя строками):
   - `Visitor ID: <uuid>`
   - `Level: 1`
6. Если `sv_vid` **есть** — отрисовать значения из `localStorage`:
   - `Visitor ID: localStorage['sv_vid']`
   - `Level: localStorage['sv_level'] || 1`

**Собираемые поля при первом визите (минимум):**
- `landing_url = location.href`
- `referrer_host = new URL(document.referrer).host || ""`
- `utm_*` — из `location.search` (если есть)
- `device_type` — простая эвристика по UA: `mobile` / `desktop` / `tablet`
- `app_platform` — `'browser'` (фикс для MVP)

---

## API бэкенда (`server/identity/visitor.py`)
### Endpoint
`POST /identity/visitor`

### Вход (JSON)
```json
{
  "sv_vid": "optional-uuid-if-present",
  "landing_url": "string",
  "referrer_host": "string",
  "utm": {
    "source": "string|null",
    "medium": "string|null",
    "campaign": "string|null",
    "term": "string|null",
    "content": "string|null"
  },
  "device_type": "desktop|mobile|tablet",
  "app_platform": "browser|pwa|native_app|webview"
}
```

### Логика на сервере
- Определить `ip_address` на бэке (учитывая `X-Forwarded-For`).
- Если пришёл `sv_vid` и запись **существует** — **не менять** запись, ответить:
  ```json
  { "visitor_id": "<sv_vid>", "level": 1, "created": false }
  ```
- Если `sv_vid` пуст/не найден — **создать** запись `visitor`:
  - `visitor_id = UUID()`
  - `level = 1`
  - `first_seen_at = now()`
  - Прислать в ответ:
    ```json
    { "visitor_id": "<uuid>", "level": 1, "created": true }
    ```

### Что сохраняем в таблицу `visitor` (MVP)
- `visitor_id` (UUID, PK, создаёт сервер)
- `level = 1`
- `first_seen_at = now()`
- `landing_url`
- `referrer_host`
- `utm_source|utm_medium|utm_campaign|utm_term|utm_content`
- `device_type`
- `app_platform`
- `ip_address` (сервер)

Остальные поля большой модели — **позже**.

---

## Ответы сервера
- Успех (создание):
  ```json
  { "visitor_id": "<uuid>", "level": 1, "created": true }
  ```
- Успех (повтор, уже существует):
  ```json
  { "visitor_id": "<uuid>", "level": 1, "created": false }
  ```
- Ошибка (пример):
  ```json
  { "error": "temporary_unavailable" }
  ```

---

## Отрисовка на странице
- Ищем контейнер с `id="visitor-id"` — если нет, создаём блок вверху страницы.
- Показываем:
  - `Visitor ID: <uuid>`
  - `Level: <число>`

---

## Тест-план (ручной)
1. Открыть `/smart/index.html` в приватном окне → должен появиться `Visitor ID` и `Level: 1`.
2. Обновить страницу → значения не меняются, сервер не вызывается.
3. Открыть другую вкладку того же домена → те же значения.
4. Открыть другой браузер → новый `Visitor ID`.
5. Проверить в Supabase: таблица `visitor` — появилась новая запись с `level=1` и полями MVP.

---

## Допущения
- `visitor_id` генерируется на сервере.
- RLS выключен на этапе тестирования.
- CORS — разрешить `https://test.smartvision.life` для POST `/identity/visitor`.
- В DEV `app_platform = 'browser'`, позже расширим.

---

## Бонус (опционально на будущее)
- `GET /identity/visitor/:id` — вернуть `{ visitor_id, level }` для повторных заходов, если понадобится ресинхронизация `sv_level`.
