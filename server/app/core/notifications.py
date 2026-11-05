"""Helper for other backend modules to raise a persistent, admin-facing
notification. Kept deliberately small — call sites decide what's worth
surfacing; this just standardizes how a Notification row gets written.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Notification

logger = logging.getLogger(__name__)


async def create_notification(
    db: AsyncSession,
    *,
    type: str,
    title: str,
    severity: str = "info",
    body: str | None = None,
    target_admin_id: uuid.UUID | None = None,
    link: str | None = None,
    meta: dict[str, Any] | None = None,
    commit: bool = True,
) -> Notification | None:
    """Create a Notification row. Best-effort: a notification failing to
    write must never break the business operation that triggered it."""
    try:
        notification = Notification(
            type=type,
            severity=severity,
            title=title[:255],
            body=body,
            target_admin_id=target_admin_id,
            link=link,
            meta=meta or {},
        )
        db.add(notification)
        if commit:
            await db.commit()
            await db.refresh(notification)
        else:
            await db.flush()
        return notification
    except Exception:
        logger.exception("create_notification failed (type=%s)", type)
        return None
