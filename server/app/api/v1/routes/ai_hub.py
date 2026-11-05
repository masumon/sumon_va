"""Admin → AI সংযোগ (AI Hub): add/test/order AI connections, prefs, daily check."""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import ai_hub as hub
from app.core.database import get_db
from app.core.device_auth import owner_or_device
from app.core.security import require_role
from app.schemas.schemas import ApiResponse

router = APIRouter(tags=["admin-ai-hub"])


def _fail(exc: hub.HubError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.message_bn)


class ConnIn(BaseModel):
    key: str = Field(default="", max_length=600)
    provider: str = Field(default="auto", max_length=30)
    base_url: str = Field(default="", max_length=300)
    account_id: str = Field(default="", max_length=64)
    label: str = Field(default="", max_length=60)


class ConnPatch(BaseModel):
    enabled: bool | None = None
    label: str | None = Field(default=None, max_length=60)
    move: int = Field(default=0, ge=-1, le=1)
    tier: str | None = Field(default=None, max_length=8)


class PrefsIn(BaseModel):
    allow_paid: bool | None = None
    paid_daily_cap: int | None = Field(default=None, ge=0, le=5000)
    tasks: dict[str, str] | None = None


class TryIn(BaseModel):
    task: str = Field(default="chat", max_length=20)
    text: str = Field(default="", max_length=1000)


@router.get("/admin/ai-hub", response_model=ApiResponse)
async def get_hub(_admin: str = Depends(owner_or_device("settings.read")), db: AsyncSession = Depends(get_db)):
    data = await hub.summary(db)
    data["cron_path"] = f"/api/v1/ai-hub/cron?token={hub.cron_token()}"
    return ApiResponse(data=data)


@router.post("/admin/ai-hub/connections", response_model=ApiResponse)
async def add_connection(payload: ConnIn, _admin: str = Depends(owner_or_device("settings.write")),
                         db: AsyncSession = Depends(get_db)):
    try:
        conn = await hub.add(db, payload.key, payload.provider, payload.base_url, payload.account_id, payload.label)
    except hub.HubError as exc:
        raise _fail(exc) from exc
    return ApiResponse(data=conn, message="যোগ হয়েছে — AI কাজ করছে")


@router.post("/admin/ai-hub/connections/{cid}/test", response_model=ApiResponse)
async def test_connection(cid: str, _admin: str = Depends(owner_or_device("settings.write")),
                          db: AsyncSession = Depends(get_db)):
    try:
        return ApiResponse(data=await hub.retest(db, cid))
    except hub.HubError as exc:
        raise _fail(exc) from exc


@router.patch("/admin/ai-hub/connections/{cid}", response_model=ApiResponse)
async def patch_connection(cid: str, payload: ConnPatch, _admin: str = Depends(owner_or_device("settings.write")),
                           db: AsyncSession = Depends(get_db)):
    try:
        return ApiResponse(data=await hub.update(db, cid, enabled=payload.enabled, label=payload.label,
                                                 move=payload.move, tier=payload.tier))
    except hub.HubError as exc:
        raise _fail(exc) from exc


@router.delete("/admin/ai-hub/connections/{cid}", response_model=ApiResponse)
async def delete_connection(cid: str, _admin: str = Depends(owner_or_device("settings.write")),
                            db: AsyncSession = Depends(get_db)):
    await hub.remove(db, cid)
    return ApiResponse(message="সংযোগ সরানো হয়েছে")


@router.put("/admin/ai-hub/prefs", response_model=ApiResponse)
async def put_prefs(payload: PrefsIn, _admin: str = Depends(owner_or_device("settings.write")),
                    db: AsyncSession = Depends(get_db)):
    return ApiResponse(data=await hub.set_prefs(db, payload.model_dump(exclude_none=True)))


@router.post("/admin/ai-hub/test-all", response_model=ApiResponse)
async def test_all(_admin: str = Depends(owner_or_device("settings.write")), db: AsyncSession = Depends(get_db)):
    return ApiResponse(data=await hub.test_all(db))


@router.post("/admin/ai-hub/try", response_model=ApiResponse)
async def try_task(payload: TryIn, _admin: str = Depends(owner_or_device("settings.read")),
                   db: AsyncSession = Depends(get_db)):
    """Admin "এখনই চেষ্টা করুন": one real answer, plus which AI gave it."""
    meta: dict = {}
    question = payload.text.strip() or "আমাদের দোকান সম্পর্কে এক লাইনে একটি স্বাগত বার্তা লিখুন।"
    try:
        text = await hub.run(db, payload.task, "You are a helpful assistant for a Bangladeshi shop. Reply briefly in Bangla.",
                             question, max_tokens=1024, meta=meta)
    except hub.HubError as exc:
        raise _fail(exc) from exc
    return ApiResponse(data={"text": text[:1500], **meta})


_cron = {"running": False}
logger = logging.getLogger(__name__)


async def _run_daily_check() -> None:
    from app.core.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as s:
            logger.info("AI hub daily check: %s", await hub.daily_check(s))
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI hub daily check failed: %s", exc)
    finally:
        _cron["running"] = False


@router.get("/ai-hub/cron", response_model=ApiResponse)
async def daily_cron(background: BackgroundTasks, token: str = Query(default="", max_length=64)):
    """Daily health check for cron-job.org (secret token in the URL). Answers at
    once and checks in the background — real AI test calls take longer than the
    30 s cron-job.org waits."""
    if not hmac.compare_digest(token, hub.cron_token()):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        from app.core.database import AsyncSessionLocal
        from app.core.service_health import mark_cron

        async with AsyncSessionLocal() as s:
            await mark_cron(s, "ai")
    except Exception:  # noqa: BLE001 — bookkeeping only
        pass
    if not _cron["running"]:
        _cron["running"] = True
        background.add_task(_run_daily_check)
    return ApiResponse(data={"started": True}, message="AI পরীক্ষা শুরু হয়েছে")
