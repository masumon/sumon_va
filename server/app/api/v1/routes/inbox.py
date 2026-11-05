"""Unified inbox: Telegram webhook, the private phone app ("Sumon's virtual assistant"), and the owner's control endpoints.

Security shape:
* Telegram: secret header only (see channels/telegram.py).
* Phone: a random token per phone; only its SHA-256 is stored; revoking a phone cuts it off at once. Pairing codes are
  single-use, valid 10 minutes, and rate limited.
* Owner endpoints need the same private permission as the WhatsApp panel (wa.manage = super admin).
"""
from __future__ import annotations

import json
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.wa_assistant import OWNER, _api_base, _audit
from app.assistant import channels as ch
from app.assistant import wa_config as wcfg
from app.assistant import wa_flow as flow
from app.assistant.channels import email_filter, imap_mail, phone_login, telegram, wake
from app.assistant.channels.ingest import ingest
from app.assistant.wa_send import SendError
from app.api.v1.routes.auth import _client_ip, _clear_failures, _is_locked, _record_failure, _register_account_failure
from app.core.admin_security import LOCK_MINUTES, is_locked as account_locked, verify_totp_once
from app.core.security import verify_password
from app.core.config import settings
from app.core.email import send_email
from app.core.rbac import has_permission
from app.core.totp_crypto import decrypt_totp_secret
from app.core.database import get_db
from app.core.device_auth import device_from_token, hash_token, new_token, owner_or_device
from app.core.rate_limit import rate_limit
from app.core.security import require_role
from app.models.models import AdminUser
from app.models.wa import InboxCommand, InboxDevice, InboxPairCode, WaContact, WaMessage
from app.schemas.schemas import ApiResponse

router = APIRouter(tags=["inbox"])
logger = logging.getLogger(__name__)
MAX_BYTES = 1_000_000
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I: the owner types it from a screen
ALERT_TTL = timedelta(hours=1)


def _now() -> datetime:
    return datetime.now(timezone.utc)


_sha = hash_token  # one hashing rule for codes and tokens


# ── Telegram (public, secret-header protected) ───────────────────────────────

@router.post("/telegram/webhook", dependencies=[Depends(rate_limit("tg-hook", 600, 60))])
async def telegram_webhook(request: Request, background: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    if not telegram.configured():
        raise HTTPException(status_code=503, detail="not configured")
    if not telegram.verify_secret(request.headers.get("x-telegram-bot-api-secret-token")):
        raise HTTPException(status_code=403, detail="bad secret")
    wcfg.use_scope("app")  # the Telegram bot belongs to the phone app
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="too large")
    try:
        update = json.loads(raw)
    except ValueError:
        return {"ok": True}
    cb = update.get("callback_query") if isinstance(update, dict) else None
    if isinstance(cb, dict) and str(cb.get("data") or "").startswith("l:"):
        # The owner answers "may this phone sign in?". This must work even while the assistant itself is still switched off
        # (a fresh server has everything off, and without this the very first sign-in could never be approved).
        await telegram.handle_callback(db, cb)
        return {"ok": True}
    cfg = await wcfg.load_config(db)
    if not (cfg.get("enabled") and (cfg.get("channels", {}).get("telegram") or {}).get("enabled")):
        return {"ok": True}  # switched off: Telegram still gets a 200 so it does not retry, nothing is stored
    ids = await telegram.handle_update(db, update)
    try:
        await db.commit()
    except IntegrityError:  # the same update twice at once (Telegram retry)
        await db.rollback()
        return {"ok": True}
    wake.notify()
    for mid in ids:
        background.add_task(flow.process_inbound, mid)
    return {"ok": True}


# ── The phone ────────────────────────────────────────────────────────────────

async def current_device(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)) -> InboxDevice:
    dev = await device_from_token(db, (authorization or "").removeprefix("Bearer ").strip())
    if not dev:
        raise HTTPException(status_code=401, detail="device not recognised")
    wcfg.use_scope("app")  # everything the phone sends or asks is the app's business, under the app's own settings
    return dev


class PairIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)
    name: str = Field(default="আমার ফোন", max_length=80)
    app_version: str | None = Field(default=None, max_length=20)


@router.post("/device/pair", dependencies=[Depends(rate_limit("dev-pair", 10, 600))])
async def device_pair(body: PairIn, db: AsyncSession = Depends(get_db)):
    row = await db.get(InboxPairCode, _sha(body.code.strip().upper()))
    if not row or row.used_at or row.expires_at < _now():
        raise HTTPException(status_code=400, detail="কোডটি ভুল বা মেয়াদ শেষ — অ্যাডমিন থেকে নতুন কোড নিন")
    token = new_token()
    dev = InboxDevice(name=body.name.strip() or "আমার ফোন", admin_id=row.admin_id, token_hash=_sha(token), app_version=body.app_version, last_seen_at=_now())
    row.used_at = _now()
    db.add(dev)
    await db.commit()
    return {"device_id": str(dev.id), "token": token}  # the only time the token is ever shown


class IngestItem(BaseModel):
    type: str = Field(default="msg", pattern="^(msg|call)$")
    channel: str = Field(pattern="^(sms|notif)$")
    sender: str = Field(min_length=1, max_length=60)      # SMS number, or the person's name shown in the notification
    app: str | None = Field(default=None, max_length=60)  # package name, for notif
    name: str | None = Field(default=None, max_length=120)  # the name saved in the phone's contacts, when there is one
    group: bool = False  # the notification belongs to a group chat
    body: str = Field(default="", max_length=4000)
    ext_id: str = Field(min_length=1, max_length=80)      # the phone's own id: a resend can never create a second message
    at: int | None = None


class IngestIn(BaseModel):
    items: list[IngestItem] = Field(max_length=50)


_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(v: str | None) -> str | None:
    """Drop NUL and other control characters (keep newline and tab): Postgres refuses NUL, and one bad SMS must not sink the batch."""
    return None if v is None else _CTRL_RE.sub("", v)


@router.post("/device/ingest", dependencies=[Depends(rate_limit("dev-ingest", 300, 60))])
async def device_ingest(body: IngestIn, background: BackgroundTasks, dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    cfg = await wcfg.load_config(db)
    # Only the owner's "phone channel off" switch stops intake. "Assistant off" used to drop every message the phone caught,
    # so nothing reached the inbox; now they are kept and simply not acted on (process_inbound checks "enabled" itself).
    if not (cfg.get("channels", {}).get("device") or {}).get("enabled", True):
        return {"stored": 0, "paused": True}
    ids: list[uuid.UUID] = []
    dropped = 0
    skipped = 0
    for it in body.items:
        sender, name, text_in, app_, ext = _clean(it.sender).strip(), _clean(it.name), _clean(it.body) or "", _clean(it.app), _clean(it.ext_id).strip()
        if not sender or not ext:
            skipped += 1
            continue
        try:
            async with db.begin_nested():  # one bad item rolls back only itself
                key = f"sms:{sender}" if it.channel == "sms" else f"notif:{(app_ or 'app')[:30]}:{sender}"
                if email_filter.is_email_source(it.channel, app_):  # mail: only what matters (promotions never reach the database)
                    known = (await db.execute(select(WaContact.id).where(WaContact.phone == key, (WaContact.is_vip == True) | (WaContact.is_family == True) | (WaContact.tags.isnot(None))).limit(1))).first() is not None  # noqa: E712
                    keep, _why = email_filter.decide(cfg, sender, text_in.splitlines()[0] if text_in else "", text_in, known)
                    if not keep:
                        dropped += 1
                        continue
                text = "[মিসড কল]" if it.type == "call" else text_in
                at = datetime.fromtimestamp(it.at / 1000, tz=timezone.utc) if it.at and it.at > 10**11 else None
                mid = await ingest(db, channel=it.channel, key=key, name=(name or sender), body=text, ext_id=ext,
                                   meta={"app": app_, "call": it.type == "call", "device": str(dev.id), **({"group": True} if it.group else {})}, at=at)
                if mid:
                    ids.append(mid)
        except IntegrityError:  # the same ext_id arrived twice at once: already stored, nothing to do
            continue
        except Exception as exc:  # noqa: BLE001 - keep the other items
            skipped += 1
            logger.warning("device ingest: item skipped (%s)", type(exc).__name__)
    if dropped:
        await email_filter.count_dropped(db, dropped)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"stored": 0, "filtered": dropped, "skipped": skipped}
    wake.notify()
    for mid in ids:
        background.add_task(flow.process_inbound, mid)
    return {"stored": len(ids), "filtered": dropped, "skipped": skipped}


@router.get("/device/poll", dependencies=[Depends(rate_limit("dev-poll", 240, 60))])
async def device_poll(wait: int = Query(default=0, ge=0, le=25), dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    """What should this phone do? With `wait`, the server holds the call (up to 25 s, no database connection held) and answers the
    instant something arrives: that is what makes the app feel real-time instead of checking every few seconds."""
    async def pending():
        return (await db.execute(select(InboxCommand).where(
            InboxCommand.status == "pending", (InboxCommand.device_id == dev.id) | (InboxCommand.device_id.is_(None)),
            InboxCommand.created_at >= _now() - ALERT_TTL,
            # a command whose message already failed/was cancelled must never reach the phone (alerts have no msg_id and stay)
            InboxCommand.msg_id.is_(None) | InboxCommand.msg_id.in_(select(WaMessage.id).where(WaMessage.status.in_(("sending", "queued"))))).order_by(InboxCommand.created_at).limit(30))).scalars().all()

    cfg = await wcfg.load_config(db)
    rows = await pending()
    changed = bool(rows)
    if not rows and wait:
        await db.commit()  # hand the connection back before waiting
        changed = await wake.wait(wait)
        rows = await pending()
    return {"commands": [{"id": str(c.id), "kind": c.kind, "target": c.target, "body": c.body} for c in rows],
            "state": {"enabled": bool(cfg.get("enabled")), "auto": cfg.get("mode") == "auto", "limits": cfg.get("limits")},
            "changed": changed}


class AckIn(BaseModel):
    done: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    delivered: list[uuid.UUID] = Field(default_factory=list, max_length=100)  # SMS delivery reports from the phone
    failed: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


@router.post("/device/ack", dependencies=[Depends(rate_limit("dev-ack", 240, 60))])
async def device_ack(body: AckIn, dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    now = _now()
    for cid in body.done:
        c = await db.get(InboxCommand, cid)
        if c and c.status == "pending" and c.device_id in (None, dev.id):
            c.status, c.done_at = "done", now
            if c.msg_id and (m := await db.get(WaMessage, c.msg_id)) and m.status in ("sending", "queued"):
                m.status, m.sent_at, m.delivery, m.error = "sent", now, "sent", None  # the phone really handed it to the network
    for cid in body.delivered:
        c = await db.get(InboxCommand, cid)
        if c and c.msg_id and c.device_id in (None, dev.id) and (m := await db.get(WaMessage, c.msg_id)):
            m.status, m.delivery = "sent", "delivered"  # the other phone received it
    for f in body.failed:
        try:
            c = await db.get(InboxCommand, uuid.UUID(str(f.get("id"))))
        except ValueError:
            continue
        if c and c.status == "pending" and c.device_id in (None, dev.id):
            c.status, c.done_at, c.error = "failed", now, str(f.get("error") or "")[:290]
            if c.msg_id and (m := await db.get(WaMessage, c.msg_id)):
                m.status, m.error = "failed", f"ফোন পাঠাতে পারেনি: {c.error}"[:290]
    await db.commit()
    return {"ok": True}


# ── Sign in with an e-mail code (the app's front door) ───────────────────────

OTP_MINUTES, OTP_MAX_TRIES, OTP_BLOCK_SECONDS, OTP_RESEND_SECONDS = 10, 5, 15 * 60, 60
_otp_fail: dict[str, tuple[int, float]] = {}  # admin id -> (wrong tries, first wrong at); in memory is enough on one free instance


def _otp_hash(admin_id: str, code: str) -> str:
    return _sha(f"otp:{admin_id}:{code.strip()}")


def _otp_blocked(admin_id: str) -> bool:
    tries, first = _otp_fail.get(admin_id, (0, 0.0))
    if tries and time.time() - first >= OTP_BLOCK_SECONDS:
        _otp_fail.pop(admin_id, None)
        return False
    return tries >= OTP_MAX_TRIES


def _otp_wrong(admin_id: str) -> None:
    tries, first = _otp_fail.get(admin_id, (0, 0.0))
    _otp_fail[admin_id] = (tries + 1, first or time.time())


async def _owner_by_email(db: AsyncSession, email: str) -> AdminUser | None:
    user = (await db.execute(select(AdminUser).where(func.lower(AdminUser.email) == email.strip().lower(), AdminUser.is_active == True))).scalar_one_or_none()  # noqa: E712
    return user if user and has_permission(user.role, OWNER) else None


_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
PHONE_KEY, PHONE_ADMIN_KEY = "owner_login_phone", "owner_login_phone_admin"


def normalize_bd_phone(raw: str | None) -> str | None:
    """Any common way of writing a Bangladesh mobile number -> 8801XXXXXXXXX, or None when it is not one."""
    d = "".join(c for c in str(raw or "").translate(_BN_DIGITS) if c.isdigit())
    if d.startswith("00880"):
        d = d[2:]
    if d.startswith("01") and len(d) == 11:
        d = "88" + d
    elif d.startswith("1") and len(d) == 10:
        d = "880" + d
    if len(d) == 13 and d.startswith("8801") and d[4] in "3456789":
        return d
    return None


def looks_like_phone(value: str | None) -> bool:
    v = str(value or "")
    return "@" not in v and sum(c.isdigit() for c in v.translate(_BN_DIGITS)) >= 10


def mask_phone(p: str | None) -> str:
    """8801711223344 -> 01711****44 (never the full number)."""
    n = normalize_bd_phone(p)
    if not n:
        return ""
    local = n[2:]
    return local[:5] + "****" + local[-2:]


async def _owner_by_login(db: AsyncSession, value: str) -> AdminUser | None:
    """E-mail, or the owner's phone number saved in settings. Unknown / malformed values just give None (same as a wrong e-mail)."""
    if not looks_like_phone(value):
        return await _owner_by_email(db, value)
    num = normalize_bd_phone(value)
    if not num or num != await flow._get_val(db, PHONE_KEY):
        return None
    aid = await flow._get_val(db, PHONE_ADMIN_KEY)
    try:
        uid = uuid.UUID(aid)
    except (ValueError, TypeError):
        return None
    user = (await db.execute(select(AdminUser).where(AdminUser.id == uid, AdminUser.is_active == True))).scalar_one_or_none()  # noqa: E712
    return user if user and has_permission(user.role, OWNER) else None


class LoginPhoneIn(BaseModel):
    phone: str = Field(min_length=5, max_length=40)


@router.get("/admin/inbox/login-phone", response_model=ApiResponse)
async def get_login_phone(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    cur = await flow._get_val(db, PHONE_KEY)
    return ApiResponse(data={"set": bool(cur), "masked": mask_phone(cur)})


@router.put("/admin/inbox/login-phone", response_model=ApiResponse)
async def set_login_phone(body: LoginPhoneIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    num = normalize_bd_phone(body.phone)
    if not num:
        raise HTTPException(status_code=400, detail="সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন 01711223344)")
    await flow._set_val(db, PHONE_KEY, num)
    await flow._set_val(db, PHONE_ADMIN_KEY, str(admin_id))
    _audit(db, admin_id, "inbox_login_phone", values={"masked": mask_phone(num)})
    await db.commit()
    return ApiResponse(data={"set": True, "masked": mask_phone(num)}, message="এখন থেকে এই নম্বর দিয়েও সাইন-ইন করা যাবে")


async def _issue_device(db: AsyncSession, user: AdminUser, name: str | None, app_version: str | None, now: datetime) -> dict:
    """Register this phone for the owner and hand back its own token (shown only once). Commits."""
    token = new_token()
    dev = InboxDevice(name=(name or "").strip() or "আমার ফোন", admin_id=user.id, token_hash=_sha(token), app_version=app_version, last_seen_at=now)
    db.add(dev)
    await db.commit()
    return {"device_id": str(dev.id), "token": token, "name": user.name}


class OtpRequestIn(BaseModel):
    email: str = Field(min_length=5, max_length=255)


@router.post("/device/otp/request", dependencies=[Depends(rate_limit("dev-otp-req", 5, 600))])
async def otp_request(body: OtpRequestIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Mail a 6-digit code to the owner. The answer is always the same, so nobody can learn which e-mails are admins."""
    if _is_locked(_client_ip(request)):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল হয়েছে — কিছুক্ষণ পরে চেষ্টা করুন")
    by_phone = looks_like_phone(body.email)
    user = await _owner_by_login(db, body.email)  # e-mail, or the saved login phone number
    if user:
        recent = (await db.execute(select(InboxPairCode.code_hash).where(
            InboxPairCode.admin_id == user.id, InboxPairCode.created_at >= _now() - timedelta(seconds=OTP_RESEND_SECONDS)).limit(1))).first()
        if not recent:
            code = f"{secrets.randbelow(10**6):06d}"
            db.add(InboxPairCode(code_hash=_otp_hash(str(user.id), code), admin_id=user.id, expires_at=_now() + timedelta(minutes=OTP_MINUTES)))
            await db.commit()
            try:
                await send_email(user.email, "সুমনের ভার্চুয়াল সহকারী — আপনার লগইন কোড",
                                 f"<p>আপনার লগইন কোড: <b style='font-size:22px;letter-spacing:4px'>{code}</b></p>"
                                 f"<p>কোডটি {OTP_MINUTES} মিনিট চলবে। আপনি না চাইলে এই ইমেইল উপেক্ষা করুন — কেউ আপনার অ্যাকাউন্টে ঢুকতে পারবে না।</p>")
            except Exception:  # noqa: BLE001 - the owner can ask again; a mail hiccup must not reveal anything
                logger.warning("otp e-mail failed", exc_info=True)
            if by_phone and telegram.configured() and settings.TELEGRAM_OWNER_ID:  # phone sign-in: also drop the code in the owner's Telegram chat
                try:
                    await telegram.send_text(settings.TELEGRAM_OWNER_ID, f"আপনার সাইন-ইন কোড: {code} ({OTP_MINUTES} মিনিট চলবে)")
                except Exception:  # noqa: BLE001 - e-mail already went out; never fail the request
                    logger.warning("otp telegram failed", exc_info=True)
    return {"ok": True, "minutes": OTP_MINUTES}


class OtpVerifyIn(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    code: str = Field(min_length=6, max_length=8)
    totp_code: str | None = Field(default=None, max_length=12)
    name: str = Field(default="আমার ফোন", max_length=80)
    app_version: str | None = Field(default=None, max_length=20)


@router.post("/device/otp/verify", dependencies=[Depends(rate_limit("dev-otp-ver", 10, 600))])
async def otp_verify(body: OtpVerifyIn, request: Request, db: AsyncSession = Depends(get_db)):
    ip = _client_ip(request)
    if _is_locked(ip):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল হয়েছে — কিছুক্ষণ পরে চেষ্টা করুন")
    bad = HTTPException(status_code=400, detail="কোডটি ভুল বা মেয়াদ শেষ — আবার কোড চান")
    user = await _owner_by_login(db, body.email)  # e-mail or the saved login phone number
    if not user:
        _record_failure(ip)
        raise bad
    uid = str(user.id)
    if _otp_blocked(uid):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল কোড — ১৫ মিনিট পরে আবার চেষ্টা করুন")
    now = _now()
    row = await db.get(InboxPairCode, _otp_hash(uid, body.code))
    if not row or row.used_at or row.expires_at < now or row.admin_id != user.id:
        _record_failure(ip)
        _otp_wrong(uid)
        raise bad
    if user.totp_enabled and user.totp_secret:  # the admin's authenticator app stays a second lock, exactly as on the web
        if not body.totp_code:
            raise HTTPException(status_code=401, detail="totp_required")  # the e-mail code is not spent yet
        step = verify_totp_once(decrypt_totp_secret(user.totp_secret), body.totp_code.strip(), user.totp_last_step)
        if step is None:
            _record_failure(ip)
            _otp_wrong(uid)
            raise HTTPException(status_code=401, detail="authenticator কোড ভুল")
        user.totp_last_step = step
    row.used_at = now
    out = await _issue_device(db, user, body.name, body.app_version, now)
    _otp_fail.pop(uid, None)
    _clear_failures(ip)
    return out  # the only time the token is ever shown


# ── The app's own passkey (fingerprint / face) ──────────────────────────────
# Bound to DEVICE_PASSKEY_RP_ID (the API host) and the app's Android signing-key origins; stored in the same `passkeys`
# table as owner_type "admin_app". A verified passkey with user verification is already two factors, so no TOTP is asked.

APP_PASSKEY_TYPE, APP_PASSKEY_MAX = "admin_app", 5


class PasskeyVerifyIn(BaseModel):
    token: str = Field(max_length=2000)
    credential: dict
    name: str = Field(default="আমার ফোন", max_length=80)
    app_version: str | None = Field(default=None, max_length=20)


@router.post("/device/passkey/options", dependencies=[Depends(rate_limit("dev-pk-opts", 30, 600))])
async def device_passkey_options():
    from app.api.v1.routes import passkeys as pkmod

    return pkmod._login_options(settings.DEVICE_PASSKEY_RP_ID, "device-login")


@router.post("/device/passkey/verify", dependencies=[Depends(rate_limit("dev-pk-ver", 10, 600))])
async def device_passkey_verify(body: PasskeyVerifyIn, request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.v1.routes import passkeys as pkmod

    ip = _client_ip(request)
    if _is_locked(ip):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল হয়েছে — কিছুক্ষণ পরে চেষ্টা করুন")
    try:
        pk = await pkmod._login_verify(db, body.token, body.credential, "device-login", APP_PASSKEY_TYPE,
                                       settings.DEVICE_PASSKEY_RP_ID, settings.device_passkey_origins)
    except HTTPException as exc:
        _record_failure(ip)
        if exc.status_code == 400:  # expired / wrong token: the same plain answer as a failed check
            raise HTTPException(status_code=401, detail="আঙুলের ছাপ/পাসকি যাচাই হয়নি — আবার চেষ্টা করুন।")
        raise
    try:
        uid = uuid.UUID(pk.owner_ref)
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="এই অ্যাকাউন্ট সক্রিয় নেই।")
    user = (await db.execute(select(AdminUser).where(AdminUser.id == uid, AdminUser.is_active == True))).scalar_one_or_none()  # noqa: E712
    now = _now()
    if not user or not has_permission(user.role, OWNER):
        _record_failure(ip)
        raise HTTPException(status_code=401, detail="এই অ্যাকাউন্ট সক্রিয় নেই।")
    if account_locked(user.locked_until, now):
        raise HTTPException(status_code=429, detail=f"অ্যাকাউন্ট সাময়িক বন্ধ (বারবার ভুলের কারণে) — {LOCK_MINUTES} মিনিট পরে চেষ্টা করুন")
    user.last_login = now
    out = await _issue_device(db, user, body.name, body.app_version, now)  # commits the passkey counter too
    _clear_failures(ip)
    return out


async def _device_admin(db: AsyncSession, dev: InboxDevice) -> AdminUser:
    user = (await db.execute(select(AdminUser).where(AdminUser.id == dev.admin_id, AdminUser.is_active == True))).scalar_one_or_none()  # noqa: E712
    if not user or not has_permission(user.role, OWNER):
        raise HTTPException(status_code=401, detail="device not recognised")
    return user


_PK_FULL = f"সর্বোচ্চ {APP_PASSKEY_MAX}টি আঙুলের ছাপ/ফেস লগইন রাখা যায় — আগে একটি মুছুন।"


@router.post("/device/passkey/register/options", response_model=ApiResponse, dependencies=[Depends(rate_limit("dev-pk-ropts", 20, 600))])
async def device_passkey_register_options(dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    from app.api.v1.routes import passkeys as pkmod

    user = await _device_admin(db, dev)
    if len(await pkmod._owner_passkeys(db, APP_PASSKEY_TYPE, str(user.id))) >= APP_PASSKEY_MAX:
        raise HTTPException(status_code=400, detail=_PK_FULL)
    return ApiResponse(data=await pkmod._register_options(None, db, APP_PASSKEY_TYPE, str(user.id), user.email, user.name or user.email,
                                                          rp_id=settings.DEVICE_PASSKEY_RP_ID, purpose="device-register"))


@router.post("/device/passkey/register/verify", response_model=ApiResponse, dependencies=[Depends(rate_limit("dev-pk-rver", 20, 600))])
async def device_passkey_register_verify(body: PasskeyVerifyIn, dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    from app.api.v1.routes import passkeys as pkmod

    user = await _device_admin(db, dev)
    if len(await pkmod._owner_passkeys(db, APP_PASSKEY_TYPE, str(user.id))) >= APP_PASSKEY_MAX:
        raise HTTPException(status_code=400, detail=_PK_FULL)
    payload = pkmod.RegisterVerifyIn(token=body.token, credential=body.credential, name=body.name)
    return ApiResponse(data=await pkmod._register_verify(None, db, APP_PASSKEY_TYPE, str(user.id), payload, rp_id=settings.DEVICE_PASSKEY_RP_ID,
                                                         origins=settings.device_passkey_origins, purpose="device-register"), message="Passkey added")


@router.get("/device/passkey/list", response_model=ApiResponse, dependencies=[Depends(rate_limit("dev-pk-list", 60, 60))])
async def device_passkey_list(dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    from app.api.v1.routes import passkeys as pkmod

    user = await _device_admin(db, dev)
    return ApiResponse(data=[pkmod._public(p) for p in await pkmod._owner_passkeys(db, APP_PASSKEY_TYPE, str(user.id))])


@router.delete("/device/passkey/{passkey_id}", response_model=ApiResponse, dependencies=[Depends(rate_limit("dev-pk-del", 30, 600))])
async def device_passkey_delete(passkey_id: uuid.UUID, dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    from app.models.models import Passkey

    user = await _device_admin(db, dev)
    p = (await db.execute(select(Passkey).where(Passkey.id == passkey_id, Passkey.owner_type == APP_PASSKEY_TYPE,
                                                Passkey.owner_ref == str(user.id), Passkey.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not p:
        raise HTTPException(status_code=404, detail="পাওয়া যায়নি")
    p.is_deleted = True
    await db.commit()
    return ApiResponse(message="Passkey removed")


@router.post("/device/logout", dependencies=[Depends(rate_limit("dev-logout", 20, 600))])
async def device_logout(dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    """Sign this phone out: its token stops working at once (the owner can also do this from the admin)."""
    dev.revoked_at = _now()
    await db.commit()
    return {"ok": True}


@router.get("/admin/inbox/business", response_model=ApiResponse)
async def business_snapshot(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The ABO shop side in four numbers (read from ABO's small read-only integration API; zeros when it is not switched on)."""
    from app.core import abo_client

    return ApiResponse(data=await abo_client.summary())


class PasswordLoginIn(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=1, max_length=200)
    totp_code: str | None = Field(default=None, max_length=12)
    name: str = Field(default="আমার ফোন", max_length=80)
    app_version: str | None = Field(default=None, max_length=20)


@router.post("/device/login", dependencies=[Depends(rate_limit("dev-login", 20, 600))])
async def device_login(body: PasswordLoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Sign this phone in with the admin e-mail and password (and the authenticator code when the admin uses one).

    Same protections as the website login: per-address and per-account lockouts, the same wrong-password answer for every
    failure, owner-only. On success the phone gets its OWN token and is remembered: it never needs the password again until
    the owner signs it out or revokes it in the admin.
    """
    ip = _client_ip(request)
    if _is_locked(ip):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল হয়েছে — কিছুক্ষণ পরে চেষ্টা করুন")
    user = await _owner_by_login(db, body.email)  # e-mail or the saved phone number
    now = _now()
    if user and account_locked(user.locked_until, now):
        raise HTTPException(status_code=429, detail=f"অ্যাকাউন্ট সাময়িক বন্ধ (বারবার ভুলের কারণে) — {LOCK_MINUTES} মিনিট পরে চেষ্টা করুন")
    if not user or not verify_password(body.password, user.password_hash):
        _record_failure(ip)
        if user:
            await _register_account_failure(db, user)
        raise HTTPException(status_code=400, detail="ইমেইল বা পাসওয়ার্ড ভুল")
    if user.totp_enabled and user.totp_secret:
        if not body.totp_code:
            raise HTTPException(status_code=401, detail="totp_required")  # password was right; ask for the authenticator code
        step = verify_totp_once(decrypt_totp_secret(user.totp_secret), body.totp_code.strip(), user.totp_last_step)
        if step is None:
            _record_failure(ip)
            await _register_account_failure(db, user)
            raise HTTPException(status_code=401, detail="authenticator কোড ভুল")
        user.totp_last_step = step
    token = new_token()
    dev = InboxDevice(name=body.name.strip() or "আমার ফোন", admin_id=user.id, token_hash=_sha(token), app_version=body.app_version, last_seen_at=now)
    user.failed_login_count, user.locked_until, user.last_login = 0, None, now
    db.add(dev)
    await db.commit()
    _clear_failures(ip)
    return {"device_id": str(dev.id), "token": token, "name": user.name}  # the only time the token is ever shown


# ── Sign in by approving in the owner's own Telegram bot (no password) ──────────────

class TelegramLoginIn(BaseModel):
    name: str = Field(default="আমার ফোন", max_length=80)
    app_version: str | None = Field(default=None, max_length=20)


async def _the_owner(db: AsyncSession) -> AdminUser | None:
    """The one owner account a phone signs in to: an active admin who may run the assistant (super admin)."""
    users = (await db.execute(select(AdminUser).where(AdminUser.is_active == True)  # noqa: E712
                              .order_by(AdminUser.last_login.desc().nullslast()))).scalars().all()
    return next((u for u in users if has_permission(u.role, OWNER)), None)


@router.post("/device/login-telegram/request", dependencies=[Depends(rate_limit("dev-tg-login", 6, 600))])
async def device_login_telegram(body: TelegramLoginIn, request: Request):
    """Step 1: the phone asks to be let in. The owner gets a Telegram message with the same 4-digit code and two buttons."""
    if not (telegram.configured() and settings.TELEGRAM_OWNER_ID):
        raise HTTPException(status_code=503, detail="Telegram বট ঠিক করা নেই — অন্য পথে ঢুকুন")
    req = phone_login.create(body.name, _client_ip(request))
    if req is None:
        raise HTTPException(status_code=429, detail="অনেকগুলো অনুরোধ হয়ে গেছে — কিছুক্ষণ পরে চেষ্টা করুন")
    text = chr(10).join([
        f'📲 "{req.name}" ফোন সুমনের ভার্চুয়াল সহকারীতে ঢুকতে চাইছে।',
        f"ফোনের স্ক্রিনে এই কোড দেখাচ্ছে: {req.code}",
        "কোড মিললে এবং আপনি নিজে চেষ্টা করলে ✅ চাপুন। না হলে ❌ চাপুন।",
        "২ মিনিট পর এটি আপনা-আপনি বাতিল হবে।",
    ])
    markup = {"inline_keyboard": [[{"text": "✅ হ্যাঁ, ঢুকতে দিন", "callback_data": f"l:y:{req.short}"},
                                   {"text": "❌ না", "callback_data": f"l:n:{req.short}"}]]}
    try:
        await telegram.send_text(settings.TELEGRAM_OWNER_ID, text, reply_markup=markup)
    except SendError:
        phone_login._requests.pop(req.request_id, None)
        raise HTTPException(status_code=502, detail="Telegram-এ বার্তা পাঠানো যায়নি — অন্য পথে ঢুকুন")
    return {"request_id": req.request_id, "code": req.code, "expires_in": phone_login.TTL_SECONDS}


@router.get("/device/login-telegram/status", dependencies=[Depends(rate_limit("dev-tg-poll", 90, 60))])
async def device_login_telegram_status(request_id: str = Query(min_length=20, max_length=80), app_version: str | None = Query(default=None, max_length=20),
                                       db: AsyncSession = Depends(get_db)):
    """Step 2: the phone asks every couple of seconds. On approval it receives its own token, exactly once."""
    req = phone_login.get(request_id)
    if req is None:
        return {"status": "expired"}
    if req.state == "denied":
        return {"status": "denied"}
    if req.state != "approved":
        return {"status": "used" if req.state == "used" else "pending"}
    user = await _the_owner(db)
    if user is None or not phone_login.consume(req):
        return {"status": "expired"}
    token = new_token()
    now = _now()
    dev = InboxDevice(name=req.name, admin_id=user.id, token_hash=_sha(token), app_version=app_version, last_seen_at=now)
    user.last_login = now
    db.add(dev)
    _audit(db, str(user.id), "inbox_phone_login_telegram")
    await db.commit()
    return {"status": "approved", "device_id": str(dev.id), "token": token, "name": user.name}  # the only time the token is ever shown


class PresenceIn(BaseModel):
    screen_on: bool
    interacted_ago_s: int = Field(ge=0, le=10**7)       # seconds since the owner last unlocked/touched the phone
    moved_ago_s: int | None = Field(default=None, ge=0, le=10**7)  # seconds since the phone last felt significant motion
    lat: float | None = Field(default=None, ge=-90, le=90)           # coarse (rounded) position, only if the owner allowed location
    lng: float | None = Field(default=None, ge=-180, le=180)


@router.post("/device/presence", dependencies=[Depends(rate_limit("dev-presence", 120, 60))])
async def device_presence(body: PresenceIn, dev: InboxDevice = Depends(current_device), db: AsyncSession = Depends(get_db)):
    """Is the owner using the phone right now? Used for smarter status ("sleeping", "on the road") and alert loudness."""
    from app.assistant import presence

    await presence.record(db, body.model_dump())
    return {"ok": True}


@router.post("/admin/inbox/contacts/{cid}/clear", response_model=ApiResponse)
async def clear_chat(cid: uuid.UUID, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    """Empty one person's saved messages (keeps the person, their tags and notes). The person itself can only be erased from the admin."""
    from sqlalchemy import delete as sql_delete

    from app.models.wa import WaContact

    c = await db.get(WaContact, cid)
    if not c:
        raise HTTPException(status_code=404, detail="ব্যক্তি পাওয়া যায়নি")
    n = (await db.execute(sql_delete(WaMessage).where(WaMessage.contact_id == cid))).rowcount or 0
    c.unread, c.summary, c.need = 0, None, None
    _audit(db, admin_id, "inbox_clear_chat", cid, {"messages": n})
    await db.commit()
    return ApiResponse(data={"removed": n}, message="চ্যাট খালি করা হয়েছে")


@router.get("/admin/inbox/email-filter", response_model=ApiResponse)
async def email_filter_state(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    cfg = await wcfg.load_config(db)
    return ApiResponse(data={**email_filter.settings_of(cfg), "dropped_today": await email_filter.dropped_today(db)})


@router.post("/email/inbound")
async def email_inbound(request: Request, background: BackgroundTasks, x_inbound_secret: str = Header(default="", max_length=128), db: AsyncSession = Depends(get_db)):
    """Cloudflare Email Routing -> Email Worker -> here. Any address on the owner's domain(s) can be sent here; no polling, no mailbox password.
    The raw message is the request body (capped at 300 KB). Only mail that matters is stored (email_filter); replies are drafts."""
    wcfg.use_scope("app")  # e-mail belongs to the phone app's inbox and settings
    import hmac as _hmac

    secret = settings.EMAIL_INBOUND_SECRET or ""
    if not secret:
        raise HTTPException(status_code=503, detail="e-mail intake is not set up")
    if not _hmac.compare_digest(secret, x_inbound_secret):
        raise HTTPException(status_code=403, detail="bad secret")
    raw = await request.body()
    if not raw or len(raw) > 300_000:
        return {"ok": False, "reason": "empty or too large"}
    cfg = await wcfg.load_config(db)
    if not (cfg.get("enabled") and (cfg.get("channels", {}).get("email") or {}).get("enabled")):
        return {"ok": True, "paused": True}
    mid, dropped = await imap_mail.accept(db, cfg, imap_mail.parse_raw(raw))
    if dropped:
        await email_filter.count_dropped(db, 1)
    await db.commit()
    if mid:
        wake.notify()
        background.add_task(flow.process_inbound, mid)
    return {"ok": True, "kept": bool(mid), "dropped": dropped}


@router.get("/email/cron")
async def email_cron(background: BackgroundTasks, token: str = Query(default="", max_length=64), db: AsyncSession = Depends(get_db)):
    """Called by cron-job.org every few minutes (secret token in the URL): reads new mail, keeps what matters."""
    wcfg.use_scope("app")  # e-mail belongs to the phone app's inbox and settings
    import hmac as _hmac

    from app.api.v1.routes.wa_assistant import cron_token

    if not _hmac.compare_digest(token, cron_token()):
        raise HTTPException(status_code=403, detail="bad token")
    if not imap_mail.configured():
        return {"ok": False, "reason": "not configured"}
    cfg = await wcfg.load_config(db)
    if not (cfg.get("enabled") and (cfg.get("channels", {}).get("email") or {}).get("enabled")):
        return {"ok": True, "paused": True}
    try:
        res = await imap_mail.run(db)
    except Exception as exc:  # noqa: BLE001 - a wrong password or a network blip must not crash the cron
        logger.warning("e-mail poll failed: %s", type(exc).__name__)
        return {"ok": False, "reason": type(exc).__name__}
    wake.notify()
    for mid in res.pop("ids"):  # type: ignore[arg-type]
        background.add_task(flow.process_inbound, mid)
    return {"ok": True, **res}


# ── Owner control (private) ──────────────────────────────────────────────────

@router.post("/admin/inbox/pair-code", response_model=ApiResponse)
async def new_pair_code(db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    db.add(InboxPairCode(code_hash=_sha(code), admin_id=uuid.UUID(admin_id), expires_at=_now() + timedelta(minutes=10)))
    _audit(db, admin_id, "inbox_pair_code")
    await db.commit()
    return ApiResponse(data={"code": code, "minutes": 10}, message="কোডটি ১০ মিনিট চলবে, একবারই ব্যবহার হবে")


@router.get("/admin/inbox/channels", response_model=ApiResponse)
async def channels(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    cfg = await wcfg.load_config(db)
    devices = (await db.execute(select(InboxDevice).order_by(InboxDevice.paired_at.desc()))).scalars().all()
    counts = dict((await db.execute(select(WaMessage.channel, func.count()).where(WaMessage.direction == "in").group_by(WaMessage.channel))).all())
    tg: dict[str, Any] = {"configured": telegram.configured(), "owner_set": bool(settings.TELEGRAM_OWNER_ID), "secret_set": bool(settings.TELEGRAM_WEBHOOK_SECRET)}
    if tg["configured"]:
        try:
            tg.update(await telegram.info())
        except SendError as exc:
            tg["error"] = str(exc)
    chs = cfg.get("channels") or {}
    return ApiResponse(data={
        "kill_switch_on": cfg.get("mode") != "auto", "limits": cfg.get("limits"),
        "channels": [{"key": k, "label": v[0], "can_auto": v[1], "icon": v[2], "messages": counts.get(k, 0)} for k, v in ch.CHANNELS.items()],
        "settings": chs, "telegram": tg, "email": {"configured": imap_mail.configured(), "inbound_configured": bool(settings.EMAIL_INBOUND_SECRET), "cron_path": f"/api/v1/email/cron?token={__import__('app.api.v1.routes.wa_assistant', fromlist=['cron_token']).cron_token()}"},
        "devices": [{"id": str(d.id), "name": d.name, "paired_at": d.paired_at.isoformat(), "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
                     "revoked": d.revoked_at is not None, "app_version": d.app_version} for d in devices],
    })


@router.delete("/admin/inbox/devices/{did}", response_model=ApiResponse)
async def revoke_device(did: uuid.UUID, db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    dev = await db.get(InboxDevice, did)
    if not dev:
        raise HTTPException(status_code=404, detail="not found")
    dev.revoked_at = _now()
    _audit(db, admin_id, "inbox_revoke_device", did)
    await db.commit()
    return ApiResponse(data={"ok": True}, message="ফোনের অনুমতি বাতিল — এখন থেকে সে আর কিছু পাঠাতে বা নিতে পারবে না")


class KillIn(BaseModel):
    on: bool  # True = stop all automatic replies (drafts only)


@router.post("/admin/inbox/kill-switch", response_model=ApiResponse)
async def kill_switch(body: KillIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    await wcfg.save_config(db, {"mode": "shadow" if body.on else "auto"})
    _audit(db, admin_id, "inbox_kill_switch", values={"on": body.on})
    await db.commit()
    return ApiResponse(data={"kill_switch_on": body.on}, message="সব অটো-উত্তর বন্ধ — শুধু খসড়া" if body.on else "অটো-উত্তর চালু")


@router.post("/admin/inbox/telegram/connect", response_model=ApiResponse)
async def telegram_connect(db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    if not (telegram.configured() and settings.TELEGRAM_WEBHOOK_SECRET):
        raise HTTPException(status_code=400, detail="আগে Render-এ TELEGRAM_BOT_TOKEN ও TELEGRAM_WEBHOOK_SECRET বসান")
    try:
        said = await telegram.set_webhook(f"{_api_base()}/api/v1/telegram/webhook")
    except SendError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    _audit(db, admin_id, "inbox_telegram_connect")
    await db.commit()
    return ApiResponse(data={"ok": True}, message=f"Telegram বলেছে: {said}")
