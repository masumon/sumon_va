"""Optional Sentry integration for persistent production telemetry.

Sentry is intentionally external to the database schema: it preserves operational
error telemetry across process restarts without introducing a new migration.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)
_SENTRY_ACTIVE = False


def init_sentry() -> bool:
    """Configure Sentry when a DSN is provided and return whether it is active."""
    global _SENTRY_ACTIVE
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        _SENTRY_ACTIVE = False
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        _SENTRY_ACTIVE = False
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed — skipping.")
        return False

    sample = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.05") or 0.05)
    environment = os.environ.get("APP_ENV", "development")
    sentry_logging = LoggingIntegration(
        level=logging.INFO,
        event_level=logging.ERROR,
    )
    sentry_sdk.init(
        dsn=dsn,
        integrations=[FastApiIntegration(), StarletteIntegration(), sentry_logging],
        traces_sample_rate=max(0.0, min(sample, 0.2)),
        environment=environment,
        send_default_pii=False,
    )
    _SENTRY_ACTIVE = True
    logger.info("Sentry initialised (env=%s)", environment)
    return True


def sentry_enabled() -> bool:
    """Return whether persistent Sentry telemetry is active for this process."""
    return _SENTRY_ACTIVE
