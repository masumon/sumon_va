"""Service-to-service API for the ABO admin "সুমন VA" tab (pair a phone, list phones, cancel a phone).

Off (404) unless VA_INTEGRATION_TOKEN is set. Every call must carry `Authorization: Bearer <token>`, `X-VA-Timestamp`
(unix seconds, within 5 minutes) and `X-VA-Signature` = HMAC-SHA256(token, "<timestamp>.<METHOD>.<path>") so a captured
request cannot be replayed later. The ABO admin browser never calls this directly: ABO's own backend does, after its normal
admin login. Only the one owner account acts here.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.device_auth import hash_token
from app.core.rate_limit import rate_limit
from app.models.models import AdminUser
from app.models.wa import InboxDevice, InboxPairCode
from app.schemas.schemas import ApiResponse

router = APIRouter(prefix="/integration", tags=["integration"])
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_SKEW_S = 300


def _now() -> datetime:
    return datetime.now(timezone.utc)


def expected_signature(token: str, ts: str, method: str, path: str) -> str:
    return hmac.new(token.encode(), f"{ts}.{method}.{path}".encode(), hashlib.sha256).hexdigest()


async def service_auth(request: Request, authorization: str = Header(default="", max_length=300),
                       x_va_timestamp: str = Header(default="", max_length=20), x_va_signature: str = Header(default="", max_length=100)) -> None:
    token = settings.VA_INTEGRATION_TOKEN
    if not token:
        raise HTTPException(status_code=404, detail="Not Found")  # switched off: the route does not exist
    if not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        skew = abs(time.time() - int(x_va_timestamp))
    except ValueError:
        raise HTTPException(status_code=403, detail="forbidden") from None
    sig = expected_signature(token, x_va_timestamp, request.method, request.url.path)
    if skew > MAX_SKEW_S or not hmac.compare_digest(sig, x_va_signature):
        raise HTTPException(status_code=403, detail="forbidden")


async def _owner(db: AsyncSession) -> AdminUser:
    owner = (await db.execute(select(AdminUser).where(AdminUser.is_active == True, AdminUser.is_deleted == False)  # noqa: E712
                              .order_by(AdminUser.created_at).limit(1))).scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=409, detail="owner account missing")
    return owner


def _device(d: InboxDevice) -> dict:
    return {"id": str(d.id), "name": d.name, "app_version": d.app_version, "paired_at": d.paired_at.isoformat(),
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None, "revoked": d.revoked_at is not None}


@router.get("/devices", response_model=ApiResponse, dependencies=[Depends(rate_limit("int-list", 60, 60)), Depends(service_auth)])
async def list_devices(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(InboxDevice).order_by(InboxDevice.paired_at.desc()))).scalars().all()
    return ApiResponse(data={"devices": [_device(d) for d in rows]})


@router.post("/pair-code", response_model=ApiResponse, dependencies=[Depends(rate_limit("int-pair", 10, 600)), Depends(service_auth)])
async def new_pair_code(db: AsyncSession = Depends(get_db)):
    owner = await _owner(db)
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    db.add(InboxPairCode(code_hash=hash_token(code), admin_id=owner.id, expires_at=_now() + timedelta(minutes=10)))
    await db.commit()
    return ApiResponse(data={"code": code, "minutes": 10}, message="কোডটি ১০ মিনিট চলবে, একবারই ব্যবহার হবে")


@router.delete("/devices/{did}", response_model=ApiResponse, dependencies=[Depends(rate_limit("int-revoke", 30, 600)), Depends(service_auth)])
async def revoke_device(did: uuid.UUID, db: AsyncSession = Depends(get_db)):
    dev = await db.get(InboxDevice, did)
    if not dev:
        raise HTTPException(status_code=404, detail="not found")
    dev.revoked_at = _now()
    await db.commit()
    return ApiResponse(data={"ok": True}, message="ফোনের অনুমতি বাতিল")
