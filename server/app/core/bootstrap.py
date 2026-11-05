import logging
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.core.config import settings
from app.models.models import AdminUser

logger = logging.getLogger(__name__)


async def bootstrap_admin() -> None:
    """Idempotent admin account bootstrap — runs on every startup.

    - Creates admin account if ADMIN_EMAIL does not already exist in DB.
    - Never overwrites or resets an existing admin.
    - Logs a warning (does not crash) if required env vars are missing.
    - Safe to run on every Render deployment and application restart.
    """
    missing = [v for v in ("ADMIN_EMAIL", "ADMIN_PASSWORD") if not getattr(settings, v, None)]
    if missing:
        logger.warning(
            "Admin bootstrap skipped — missing env vars: %s. "
            "Set these on Render to create the admin account automatically.",
            ", ".join(missing),
        )
        return

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AdminUser).where(AdminUser.email == settings.ADMIN_EMAIL)
            )
            existing = result.scalar_one_or_none()

            if existing:
                logger.info(
                    "Admin bootstrap: account already exists for %s — no action taken.",
                    settings.ADMIN_EMAIL,
                )
                return

            admin = AdminUser(
                email=settings.ADMIN_EMAIL,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                name=settings.ADMIN_NAME or "Admin",
                role="super_admin",
                is_active=True,
            )
            db.add(admin)
            await db.commit()
            logger.info(
                "Admin bootstrap: created super_admin account for %s.",
                settings.ADMIN_EMAIL,
            )

    except Exception as exc:
        logger.error("Admin bootstrap failed — application will still start: %s", exc, exc_info=exc)
