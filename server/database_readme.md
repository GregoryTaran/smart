# 🧠 SMART VISION — Database README

## 📦 Архитектура базы данных
База данных построена на **Supabase (PostgreSQL)** и связана с проектом через SDK (`@supabase/supabase-js` / Python Supabase Client).

---

## 🧱 Основная таблица: `profiles`

| Поле | Тип | Default | Описание |
|------|-----|----------|-----------|
| `id` | `uuid` | — | Primary Key, совпадает с `auth.users.id` |
| `username` | `text` | NULL | Отображаемое имя пользователя |
| `full_name` | `text` | NULL | Полное имя |
| `email` | `text` | NULL | Email пользователя |
| `role` | `text` | `'user'` | Роль (напр. `user`, `admin`) |
| `is_guest` | `boolean` | `false` | Флаг гостя |
| `created_at` | `timestamp with time zone` | `now()` | Дата создания |

### 🔗 Связи
- `profiles.id` → `auth.users.id`  
  **Foreign Key**, `ON DELETE CASCADE`, `ON UPDATE NO ACTION`.

---

## ⚙️ Row Level Security (RLS) и политики
```sql
alter table public.profiles enable row level security;

create policy "profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "users can update their own profile"
  on public.profiles for update using (auth.uid() = id);
```

---

## ⚡️ Триггер автоматического создания `profiles`
Создаёт профиль при любом новом пользователе (включая гостей):

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, is_guest)
  values (new.id, new.email, true)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
```

---

## 👤 Гости и регистрация

- Гость или пользователь создаётся через `supabase.auth.signUp({ email, password })`.
- Поле `is_guest` автоматически помечает юзера, если его создает триггер.
- В Supabase отключены email подтверждения, чтобы процесс был быстрым и удобным для dev-сценария.

---

## 🌐 Пример кода на фронте

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://bqtlomddtojirtkazpvj.supabase.co',
  process.env.SUPABASE_ANON_KEY
)

async function signUpGuest() {
  const email = `guest+${crypto.randomUUID()}@example.com`
  const password = crypto.randomUUID()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) console.error('SignUp error:', error)
  else console.log('Guest created:', data.user)
}
```

---

## 🤖 Переменные окружения (Render / .env)
| Переменная | Описание |
|-------------|-----------|
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_ANON_KEY` | Публичный ключ для фронта |
| `SUPABASE_SERVICE_ROLE_KEY` | Серверный ключ (только для бэка) |

---

## 🔮 Проверка триггера
Файл: `/Database/guest-test.html`

🔍 После нажатия кнопки:
1. Создаётся новый гость.
2. `auth.getUser()` возвращает пользователя.
3. В таблице `profiles` появляется запись (без подтверждений, автоматически).

---

Теперь связка **frontend → Supabase Auth → Database** готова к использованию. 🚀

