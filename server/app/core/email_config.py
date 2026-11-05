"""Effective email/SMTP configuration — DB settings first, env as fallback.

Lets an admin change SMTP + notification addresses from the panel
(Setting table) without a redeploy, while still working from environment
variables when no DB override is present. Nothing is hardcoded.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Setting

# Setting keys an admin can edit in the panel to override env values.
EMAIL_SETTING_KEYS = [
    "smtp_host", "smtp_port", "smtp_user", "smtp_password",
    "smtp_from", "smtp_from_name", "smtp_tls",
    "admin_notify_email", "contact_email", "business_email",
    "email_provider", "resend_api_key",
]

_HIDDEN = "***HIDDEN***"


def _clean(v: str | None) -> str:
    v = (v or "").strip()
    return "" if v == _HIDDEN else v


async def resolve_email_config(db: AsyncSession) -> dict:
    """Merge admin-editable Setting overrides over the env defaults."""
    rows = (await db.execute(
        select(Setting).where(Setting.key.in_(EMAIL_SETTING_KEYS), Setting.is_deleted == False)  # noqa: E712
    )).scalars().all()
    o = {s.key: _clean(s.value) for s in rows}

    try:
        port = int(o.get("smtp_port") or settings.SMTP_PORT or 587)
    except (TypeError, ValueError):
        port = settings.SMTP_PORT or 587

    tls = settings.SMTP_TLS
    if o.get("smtp_tls"):
        tls = o["smtp_tls"].lower() in ("true", "1", "yes")

    # Notification recipient: explicit setting → env → contact/business email.
    notify = (
        o.get("admin_notify_email")
        or settings.ADMIN_NOTIFY_EMAIL
        or o.get("business_email")
        or o.get("contact_email")
        or settings.BUSINESS_EMAIL
    )

    user = o.get("smtp_user") or settings.SMTP_USER
    return {
        "host": o.get("smtp_host") or settings.SMTP_HOST,
        "port": port,
        "user": user,
        "password": o.get("smtp_password") or settings.SMTP_PASSWORD,
        # Gmail requires From to match the authenticated user, so fall back to it.
        "from_addr": o.get("smtp_from") or settings.SMTP_FROM or user,
        "from_name": o.get("smtp_from_name") or settings.EMAIL_SENDER_NAME,
        "tls": tls,
        "notify": notify,
        "contact_email": o.get("contact_email") or o.get("business_email") or settings.BUSINESS_EMAIL,
    }


def env_email_config() -> dict:
    """Env-only config (used when no DB session is available)."""
    return {
        "host": settings.SMTP_HOST,
        "port": settings.SMTP_PORT or 587,
        "user": settings.SMTP_USER,
        "password": settings.SMTP_PASSWORD,
        "from_addr": settings.SMTP_FROM or settings.SMTP_USER,
        "from_name": settings.EMAIL_SENDER_NAME,
        "tls": settings.SMTP_TLS,
        "notify": settings.ADMIN_NOTIFY_EMAIL or settings.BUSINESS_EMAIL,
        "contact_email": settings.BUSINESS_EMAIL,
    }


def is_smtp_configured(cfg: dict) -> bool:
    return bool(cfg.get("host") and cfg.get("user") and cfg.get("password"))


async def resolve_notify_email(db: AsyncSession) -> str:
    """Admin-editable recipient for internal notifications (panel → env)."""
    return (await resolve_email_config(db)).get("notify", "")
