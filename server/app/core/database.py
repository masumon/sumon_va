from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Supabase (and other hosted Postgres services) require SSL.
# asyncpg accepts ssl as a connect_arg when not embedded in the URL.
_url = settings.DATABASE_URL
_is_supabase = "supabase.co" in _url or "pooler.supabase.com" in _url
_connect_args = {"ssl": "require"} if _is_supabase else {}


def _should_echo_sql() -> bool:
    return bool(settings.DEBUG) and settings.APP_ENV.strip().lower() != "production"


engine = create_async_engine(
    _url,
    # Supabase free's session pooler allows only 15 clients in total, shared by the running
    # instance, the new one during a Render deploy, backups and any script. 2+3 = 5 per process
    # keeps two overlapping instances well under the cap; extra requests simply wait their turn.
    pool_size=2,
    max_overflow=3,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=300,  # recycle connections every 5 min (avoids stale-conn errors)
    echo=_should_echo_sql(),
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[override]
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
