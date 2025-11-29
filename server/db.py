# db.py
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
            command_timeout=5,
            statement_cache_size=0,              # отключаем prepared statements
            max_cached_statement_lifetime=0,
            max_cached_statement_size=0
        )
