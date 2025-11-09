
 📘 SMART VISION — Database Architecture (Supabase)

## 🧩 Общая структура

Проект использует **Supabase** как базу данных, авторизацию и хранилище.  
Supabase управляет базовой таблицей пользователей (`auth.users`), а мы расширяем её своей таблицей `profiles`, где храним все данные, нужные приложению.

[ Frontend (JS + HTML) ] ⇄ [ Backend (Python API) ] ⇄ [ Supabase (Auth + DB) ]

pgsql
Копировать код

---

## 🔑 Авторизация и идентификация

- **Авторизация** выполняется только через **Supabase Auth** (`email + password`).
- **Supabase** создаёт и хранит пользователей в системной таблице `auth.users`.
- **JWT-токен**, выданный Supabase, используется для всех запросов — и на фронте, и на бэке.
- **Backend** (Python) проверяет токен через SDK `supabase.auth.get_user(token)`.

---

## 🧱 Таблицы

### 1️⃣ `auth.users` *(создаётся Supabase автоматически)*
| Поле | Описание |
|------|-----------|
| `id` | UUID — уникальный идентификатор пользователя |
| `email` | Электронная почта |
| `created_at` | Время регистрации |
| `last_sign_in_at` | Время последнего входа |
| `role` | Обычно "authenticated" |
| `raw_user_meta_data` | JSON с дополнительными данными |

> Эта таблица **управляется Supabase** — пароли, безопасность и аутентификация находятся под его контролем.

---

### 2️⃣ `public.profiles` *(создаётся нами)*

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  email text,
  role text default 'user',
  avatar_url text,
  bio text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.profiles enable row level security;

create policy "profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- триггер для автосоздания профиля
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
⚙️ Работа в коде
📍 Backend (Python)
python
Копировать код
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Проверяем токен и получаем данные пользователя
user = supabase.auth.get_user(token)
user_id = user.user.id

# Получаем профиль
profile = supabase.table("profiles").select("*").eq("id", user_id).execute()
💻 Frontend (JavaScript)
js
Копировать код
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Регистрация / вход
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
localStorage.setItem('access_token', data.session.access_token)
🧠 Принцип работы (в 3 шага)
1️⃣ Пользователь регистрируется → Supabase создаёт запись в auth.users и автоматически в profiles.
2️⃣ При входе фронт получает JWT-токен → сохраняет в localStorage.
3️⃣ Backend проверяет токен и обращается к profiles через Supabase SDK.

🗄️ Как смотреть пользователей
В Supabase Studio → Table Editor → profiles видно всех пользователей (id, email, имя, дата входа).

Можно выполнять SQL-запрос:

sql
Копировать код
select p.id, p.full_name, p.email, a.last_sign_in_at
from profiles p
join auth.users a on a.id = p.id;
🔒 Преимущества этой системы
✅ Supabase берёт на себя безопасность, шифрование и управление сессиями
✅ Мы видим и контролируем свои данные через profiles
✅ Прямая связь auth.users.id ↔ profiles.id
✅ Простая интеграция с фронтом (JS) и бэком (Python)
✅ Готовность к масштабированию (роли, права, storage, связи и т.д.)

📎 Итого
Supabase = Auth + DB + Security
Python Backend = бизнес-логика
JS Frontend = UI и вход пользователей
Всё остальное лежит в базе и видимо в Supabase Studio.

💡 Следующий шаг:
создаём SQL-миграцию profiles.sql в /Database/migrations/ и применяем её в Supabase SQL Editor.





## 👤 Анонимные пользователи (Guest / Temporary ID)

Иногда нужно, чтобы приложение работало и **до авторизации** —  
например, для черновиков, предварительных действий или загрузок.

### Как это работает
- Supabase может создать временного анонимного пользователя без email.  
- Он получает **уникальный `id`**, хранится в Supabase, но не требует регистрации.  
- Позже этот «гость» может быть обновлён в полноценного пользователя.

### Пример на фронте (JS)
```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// создаём анонимного пользователя
const { data, error } = await supabase.auth.signUp({
  email: `${crypto.randomUUID()}@guest.local`,
  password: crypto.randomUUID(),
})
if (error) console.error(error)
else localStorage.setItem('access_token', data.session.access_token)
📦 Теперь у гостя есть id и сессия, и он может:

писать в таблицы с разрешённой политикой RLS;

сохранять временные данные (черновики, файлы);

при желании «апгрейдиться» в полноценный профиль через auth.updateUser().

🧱 Таблицы
1️⃣ auth.users (создаётся Supabase автоматически)
Поле	Описание
id	UUID — уникальный идентификатор
email	Email или сгенерированный guest email
created_at	Дата регистрации
last_sign_in_at	Последний вход
raw_user_meta_data	JSON-мета, можно хранить гостевые флаги

2️⃣ public.profiles (наша таблица)
sql
Копировать код
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  full_name text,
  email text,
  role text default 'user',
  is_guest boolean default false,
  created_at timestamp default now()
);
При создании гостя is_guest = true,
при обновлении в реального юзера — is_guest = false.

⚙️ Использование в коде
Backend (Python)

python
Копировать код
user = supabase.auth.get_user(token)
profile = supabase.table("profiles").select("*").eq("id", user.user.id).execute()
Frontend (JS)

js
Копировать код
const { data: { user } } = await supabase.auth.getUser()
console.log(user.id, user.email)
🧠 Принцип работы
1️⃣ Пользователь входит или создаётся как гость → запись в auth.users.
2️⃣ Триггер создаёт профиль в profiles.
3️⃣ Все операции идут по id, независимо от того, гость это или зарегистрированный.
4️⃣ При апгрейде гостя в реального пользователя — его id остаётся тем же.






| Уровень        | Что хранится                     | Где                            |
| -------------- | -------------------------------- | ------------------------------ |
| `auth.users`   | id, email, пароль, токен         | встроенная таблица Supabase    |
| `profiles`     | имя, ник, фото и всё остальное   | твоя таблица `public.profiles` |
| `access_token` | JWT-токен                        | хранится в браузере            |
| `user session` | создаётся Supabase автоматически | Supabase backend               |


Логика идентификации
При регистрации через Supabase (signUp) автоматически появляется запись в auth.users.
Триггер (или код) создаёт запись в profiles, где id = auth.users.id.
Всё, что тебе нужно для связи — это user_id (UUID).
При авторизации Supabase возвращает токен JWT, в котором зашит этот id.
Ты можешь использовать этот id, чтобы получать профиль из profiles.