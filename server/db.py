import asyncpg
import os

DB_CONN = os.getenv("DATABASE_URL")

pool = None

async def init_db():
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(
            dsn=DB_CONN,
            min_size=1,
            max_size=5,
            # Единственный параметр, который ОБЯЗАТЕЛЬНО должен быть:
            statement_cache_size=0
        )
