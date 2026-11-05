"""Email provider factory — instantiate correct provider based on configuration."""
import logging
from app.core.config import settings
from app.core.email_provider import EmailProvider, SMTPProvider, ResendProvider

logger = logging.getLogger(__name__)


async def _db_email_overrides() -> dict[str, str]:
    """Admin-editable email_provider / resend_api_key overrides (Setting
    table), same pattern as resolve_email_config() for SMTP fields."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.models import Setting

    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(Setting).where(
                    Setting.key.in_(["email_provider", "resend_api_key"]),
                    Setting.is_deleted == False,  # noqa: E712
                )
            )).scalars().all()
        return {r.key: (r.value or "").strip() for r in rows if (r.value or "").strip() and r.value != "***HIDDEN***"}
    except Exception:
        logger.warning("Could not load email provider override from DB, using env only")
        return {}


async def get_email_provider() -> EmailProvider:
    """
    Instantiate the configured email provider.

    Priority:
    1. Admin-set "email_provider" / "resend_api_key" Settings (panel, no redeploy)
    2. EMAIL_PROVIDER / RESEND_API_KEY environment variables
    3. Falls back to SMTP (backward-compatible)

    Raises RuntimeError if provider is misconfigured.
    """
    overrides = await _db_email_overrides()
    provider_name = (overrides.get("email_provider") or settings.EMAIL_PROVIDER or "smtp").lower().strip()
    resend_key = overrides.get("resend_api_key") or settings.RESEND_API_KEY

    logger.debug("Initializing email provider: %s", provider_name)

    if provider_name == "resend":
        if not resend_key:
            logger.error("Resend selected but RESEND_API_KEY not configured, falling back to SMTP")
        else:
            try:
                provider = ResendProvider(
                    api_key=resend_key,
                    from_email=settings.SMTP_FROM or settings.BUSINESS_EMAIL,
                    from_name=settings.EMAIL_SENDER_NAME,
                    reply_to=settings.EMAIL_REPLY_TO,
                )
                if not provider.validate():
                    logger.warning("Resend validation failed, falling back to SMTP")
                else:
                    logger.info("Using Resend email provider")
                    return provider
            except RuntimeError as e:
                logger.warning("Resend initialization failed: %s, falling back to SMTP", e)

        # Fallback to SMTP if Resend failed
        logger.info("Falling back to SMTP provider")
        from app.core.email_config import env_email_config, resolve_email_config
        from app.core.database import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as db:
                cfg = await resolve_email_config(db)
        except Exception:
            logger.warning("Could not load SMTP config from DB, using env only")
            cfg = env_email_config()

        provider = SMTPProvider(cfg)
        if not provider.validate():
            logger.warning("SMTP provider also not configured")
        return provider

    elif provider_name == "smtp" or not provider_name:
        # Load config from database (admin overrides) or environment
        from app.core.email_config import env_email_config, resolve_email_config
        from app.core.database import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as db:
                cfg = await resolve_email_config(db)
        except Exception:
            logger.warning("Could not load SMTP config from DB, using env only")
            cfg = env_email_config()

        provider = SMTPProvider(cfg)
        if not provider.validate():
            logger.warning("SMTP provider not configured")
            # Don't raise — allow graceful degradation (log warning in email.py)
        logger.info("Using SMTP email provider")
        return provider

    else:
        logger.error("Unknown email provider: %s", provider_name)
        raise RuntimeError(f"Unknown email provider: {provider_name}")
