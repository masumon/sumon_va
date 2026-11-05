"""Paired-phone authentication for the owner's private app ("Sumon's virtual assistant").

A phone pairs once with a short-lived code the owner creates while signed in, and receives a random token ("dvc_...").
Only the token's SHA-256 is stored, so a database leak does not leak working tokens; revoking a phone cuts it off at once.

`owner_or_device(permission)` lets the *same* route handler accept either the normal admin session or a paired phone,
so the phone app never needs a duplicate copy of any handler. Use it only on routes a lost phone may safely touch
(reading the inbox, replying, the kill switch); secrets, webhook binding and erasing people stay admin-session only.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import bearer_scheme, require_admin, require_role

DEVICE_PREFIX = "dvc_"
_SEEN_EVERY = timedelta(seconds=60)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return DEVICE_PREFIX + secrets.token_urlsafe(32)


def is_device_token(token: str) -> bool:
    return token.startswith(DEVICE_PREFIX)


async def device_from_token(db: AsyncSession, token: str):
    """The active (not revoked) paired phone for this token, or None. Touches last_seen at most once a minute."""
    from app.models.wa import InboxDevice

    if not is_device_token(token):
        return None
    dev = (await db.execute(select(InboxDevice).where(InboxDevice.token_hash == hash_token(token), InboxDevice.revoked_at.is_(None)))).scalar_one_or_none()
    if dev:
        now = datetime.now(timezone.utc)
        if not dev.last_seen_at or now - dev.last_seen_at > _SEEN_EVERY:
            dev.last_seen_at = now
            await db.commit()
    return dev


def owner_or_device(permission: str):
    """Dependency: a paired phone OR the normal admin session, both held to the same permission. Returns the admin id."""
    jwt_dependency = require_role(permission)

    async def _dependency(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
                          db: AsyncSession = Depends(get_db)) -> str:
        token = credentials.credentials if credentials else ""
        if not is_device_token(token):
            return await jwt_dependency(await require_admin(request, credentials, db), db)
        from app.core.rbac import check_role
        from app.models.models import AdminUser

        dev = await device_from_token(db, token)
        if not dev or not dev.admin_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="device not recognised")
        user = (await db.execute(select(AdminUser).where(AdminUser.id == dev.admin_id, AdminUser.is_active == True))).scalar_one_or_none()  # noqa: E712
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin account not found")
        check_role(user.role, permission)
        from app.assistant import wa_config as wcfg
        wcfg.use_scope("app")  # the phone app reads and changes ONLY its own assistant settings, never the website's
        return str(dev.admin_id)

    setattr(_dependency, "_abo_required_permission", permission)
    return _dependency
