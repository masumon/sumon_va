"""Sumon's personal WhatsApp assistant — Meta webhook (public) + admin panel API (super admin only).

Public:  GET/POST /wa/webhook (Meta verifies with a token; every POST is checked against the app secret),
         GET /wa/cron (cron-job.org, every minute: sends delayed replies, morning summary, clean-up).
Admin:   /admin/wa/* — settings, contacts/inbox, notes, tasks, simulator, learning, report, setup.
Nothing happens until the owner switches the assistant on in the panel.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import f0 as f0_mod
from app.assistant import history_import
from app.assistant import task_details
from app.assistant import identity, memory, presence, privacy, relationship
from app.assistant import wa_brain as brain
from app.assistant import wa_coexist as coexist
from app.assistant import wa_config as wcfg
from app.assistant import wa_flow as flow
from app.assistant import wa_health
from app.assistant import wa_send
from app.assistant.channels import alerts as alerts_mod
from app.assistant.channels import wake
from app.core.config import settings
from app.core.database import get_db
from app.core.device_auth import owner_or_device
from app.core.rate_limit import rate_limit
from app.core.security import require_role
from app.models.models import ActivityLog
from app.models.wa import WaContact, WaMessage, WaNote, WaTask
from app.schemas.schemas import ApiResponse

router = APIRouter(tags=["whatsapp-assistant"])
OWNER = "wa.manage"
MAX_HOOK_BYTES = 5_000_000  # normal payloads are a few KB; a phone-app history sync can carry thousands of messages
META_SAMPLE_PHONE_ID = "123456123"  # the id inside Meta's dashboard "Send to My Server" sample  # held only by super_admin ("*") — these are private chats


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _api_base() -> str:
    return (os.environ.get("BACKUP_API_URL") or settings.FRONTEND_URL).rstrip("/")  # this server's own public address


def cron_token() -> str:
    return hmac.new(settings.SECRET_KEY.encode(), b"wa-cron", hashlib.sha256).hexdigest()[:32]


def _audit(db: AsyncSession, admin_id: str, action: str, entity_id: uuid.UUID | None = None, values: dict | None = None) -> None:
    db.add(ActivityLog(admin_id=uuid.UUID(admin_id), action=action, entity_type="wa_assistant", entity_id=entity_id, new_values=values))


# ── Meta webhook (public) ───────────────────────────────────────────────────────

@router.get("/wa/webhook")
async def verify(request: Request, db: AsyncSession = Depends(get_db)):
    q = request.query_params
    expected = (await wcfg.get_secrets(db)).get("verify_token", "")
    if q.get("hub.mode") == "subscribe" and expected and hmac.compare_digest(q.get("hub.verify_token", ""), expected):
        await wa_health.record(db, wa_health.HOOK_VERIFIED)
        return PlainTextResponse(q.get("hub.challenge", ""))
    raise HTTPException(status_code=403, detail="forbidden")


def _text_of(m: dict[str, Any]) -> tuple[str, str, str]:
    """(kind, body, media_id) from one Meta message object."""
    t = m.get("type", "text")
    if t == "text":
        return "text", (m.get("text") or {}).get("body", ""), ""
    if t == "audio":
        return "audio", "", (m.get("audio") or {}).get("id", "")
    if t in ("image", "video", "document"):
        x = m.get(t) or {}
        return t if t != "document" else "doc", x.get("caption") or x.get("filename") or f"[{t}]", x.get("id", "")
    if t == "button":
        return "text", (m.get("button") or {}).get("text", ""), ""
    if t == "interactive":
        i = m.get("interactive") or {}
        r = i.get("button_reply") or i.get("list_reply") or {}
        return "text", r.get("title", ""), ""
    if t == "location":
        return "other", "[লোকেশন পাঠিয়েছেন]", ""
    return "other", f"[{t}]", ""


@router.post("/wa/webhook", dependencies=[Depends(rate_limit("wa-hook", 1500, 60))])
async def receive(request: Request, background: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    if int(request.headers.get("content-length") or 0) > MAX_HOOK_BYTES:
        raise HTTPException(status_code=413, detail="too large")
    raw = await request.body()
    if len(raw) > MAX_HOOK_BYTES:
        raise HTTPException(status_code=413, detail="too large")
    creds = await wcfg.get_secrets(db)
    if not creds.get("app_secret"):
        raise HTTPException(status_code=503, detail="not configured")
    if not wa_send.verify_signature(creds["app_secret"], raw, request.headers.get("x-hub-signature-256")):
        await wa_health.log_events(db, ["✗ একটি অনুরোধ এসেছে কিন্তু স্বাক্ষর মেলেনি (App Secret ভুল বা বদলে গেছে)"], throttle="bad-sig")
        await wa_health.record(db, wa_health.HOOK_BAD)  # shown in the setup panel: "Meta sent a message but the App Secret did not match"
        raise HTTPException(status_code=403, detail="bad signature")
    await wa_health.record(db, wa_health.HOOK_OK)
    cfg = await wcfg.load_config(db)
    try:
        payload = json.loads(raw)
    except ValueError:
        return {"ok": True}
    await wa_health.log_events(db, wa_health.summarize(payload))  # shown in the setup panel: what Meta really sent
    if not cfg.get("enabled"):
        return {"ok": True}  # switched off: Meta gets a 200 (so it keeps the hook alive), nothing is stored
    new_ids: list[uuid.UUID] = []
    for entry in payload.get("entry") or []:
        for ch in entry.get("changes") or []:
            val, field = ch.get("value") or {}, ch.get("field")
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in val.get("contacts") or []}
            pid = str((val.get("metadata") or {}).get("phone_number_id") or "")
            if field in ("messages", "history", "smb_app_state_sync", "smb_message_echoes") and pid and creds.get("phone_number_id") and pid not in (creds["phone_number_id"], META_SAMPLE_PHONE_ID):
                continue  # another WhatsApp number of the same app (e.g. a business line): not this assistant's chat
            if field == "messages":
                for m in val.get("messages") or []:
                    if await coexist.edit_or_revoke(db, m, _text_of) or await coexist.unsupported(db, m):
                        continue  # edited/deleted/unreadable: no new message, no reply
                    wid = m.get("id")
                    if not wid or (await db.execute(select(WaMessage.id).where(WaMessage.wa_id == wid))).first():
                        continue
                    phone = brain.normalize_phone(m.get("from", ""))
                    if not phone:  # people who hide their number behind a WhatsApp username: keep them, by Meta's own user id
                        phone = str(m.get("from_user_id") or "")[:20]
                    if not phone:
                        continue
                    contact = await flow.upsert_contact(db, phone, names.get(m.get("from")))
                    kind, body, media = _text_of(m)
                    ts = datetime.fromtimestamp(int(m.get("timestamp") or _now().timestamp()), tz=timezone.utc)
                    msg = WaMessage(contact_id=contact.id, direction="in", wa_id=wid, kind=kind, body=body[:4000], status="received",
                                    meta={"media_id": media} if media else {}, created_at=ts)
                    db.add(msg)
                    contact.unread += 1
                    contact.last_inbound_at = contact.last_message_at = ts
                    await db.flush()
                    new_ids.append(msg.id)
                for s in val.get("statuses") or []:  # delivery ticks / failures of our own sends
                    row = (await db.execute(select(WaMessage).where(WaMessage.wa_id == s.get("id")))).scalar_one_or_none()
                    if row:
                        row.delivery = str(s.get("status", ""))[:12]
                        if s.get("status") == "failed":
                            row.status, row.error = "failed", str((s.get("errors") or [{}])[0].get("title", ""))[:290]
            elif field == "history":
                await coexist.history(db, cfg, val, _text_of)
            elif field == "smb_app_state_sync":
                await coexist.contacts_sync(db, val)
            elif field == "account_update":
                await coexist.account_update(db, val)
            elif field == "smb_message_echoes":  # Sumon typed a reply on his own phone → assistant steps back
                for e in val.get("message_echoes") or []:
                    phone = brain.normalize_phone(e.get("to", ""))
                    known = (await db.execute(select(WaContact).where(WaContact.phone == phone))).scalar_one_or_none()
                    if known and e.get("id") and not (await db.execute(select(WaMessage.id).where(WaMessage.wa_id == e["id"]))).first():
                        kind, body, _ = _text_of(e)
                        db.add(WaMessage(contact_id=known.id, direction="out", wa_id=e["id"], kind=kind, body=body[:4000],
                                         status="sent", reason="owner", sent_at=_now()))
                        known.state, known.unread = "owner", 0
                        known.hold_until = _now() + timedelta(hours=int(cfg.get("hold_hours", 12)))
                        known.last_outbound_at = known.last_message_at = _now()
    try:
        await db.commit()
    except IntegrityError:  # the same message arrived twice at once (Meta retry): the first copy is already stored
        await db.rollback()
        return {"ok": True}
    wake.notify()
    for mid in new_ids:
        background.add_task(flow.process_inbound, mid)
    return {"ok": True}


@router.get("/wa/cron", response_model=ApiResponse, dependencies=[Depends(rate_limit("wa-cron", 30, 60))])
async def cron(token: str = Query(default="", max_length=64), db: AsyncSession = Depends(get_db)):
    """cron-job.org, every minute."""
    if not hmac.compare_digest(token, cron_token()):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        from app.core.service_health import mark_cron

        await mark_cron(db, "wa")
    except Exception:  # noqa: BLE001 — bookkeeping must never block the work
        await db.rollback()
    return ApiResponse(data=await flow.run_cron(db))


# ── shapes ──────────────────────────────────────────────────────────────────────

def _iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def _contact(c: WaContact, preview: str | None = None) -> dict[str, Any]:
    window_left = None
    if c.last_inbound_at:
        window_left = max(0, int((c.last_inbound_at + flow.WINDOW - _now()).total_seconds() // 60))
    return {"id": str(c.id), "channel": c.channel or "whatsapp", "category": c.category, "tags": c.tags or [], "phone": c.phone, "name": c.name, "calls_him": c.calls_him, "relation": c.relation, "gender": c.gender,
            "mode": c.mode, "is_vip": c.is_vip, "is_family": c.is_family, "is_blocked": c.is_blocked, "state": c.state,
            "hold_until": _iso(c.hold_until), "priority": c.priority, "need": c.need, "summary": c.summary, "profile": c.profile,
            "unread": c.unread, "lang": c.lang, "last_message_at": _iso(c.last_message_at), "window_minutes_left": window_left,
            "preview": (privacy.unseal(preview) or "")[:120]}


def _tag(m: WaMessage) -> str | None:
    """A small label for messages that are not ordinary new ones."""
    meta = m.meta or {}
    return "মুছে ফেলা হয়েছে" if meta.get("revoked") else "এডিট করা হয়েছে" if meta.get("edited") else "পুরনো চ্যাট" if m.status == coexist.IMPORTED else None


def _message(m: WaMessage) -> dict[str, Any]:
    return {"id": str(m.id), "direction": m.direction, "kind": m.kind, "body": privacy.unseal(m.body), "transcript": privacy.unseal(m.transcript), "status": m.status,
            "reason": m.reason, "delivery": m.delivery, "error": m.error, "feedback": m.feedback, "created_at": _iso(m.created_at),
            "send_after": _iso(m.send_after), "note": (m.meta or {}).get("note"), "ai": (m.meta or {}).get("ai"), "tag": _tag(m)}


async def _get_contact(db: AsyncSession, cid: uuid.UUID) -> WaContact:
    c = await db.get(WaContact, cid)
    if not c:
        raise HTTPException(status_code=404, detail="ব্যক্তি পাওয়া যায়নি")
    return c


# ── settings / setup ────────────────────────────────────────────────────────────

class ConfigIn(BaseModel):
    config: dict[str, Any]


class SecretsIn(BaseModel):
    token: str = Field(default="", max_length=600)
    phone_number_id: str = Field(default="", max_length=60)
    waba_id: str = Field(default="", max_length=60)
    app_secret: str = Field(default="", max_length=200)
    graph_version: str = Field(default="", max_length=10)


@router.get("/admin/wa/config", response_model=ApiResponse)
async def get_config(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    return ApiResponse(data={"config": await wcfg.load_config(db, force=True), "status_now": brain.current_status(await wcfg.load_config(db))})


@router.put("/admin/wa/config", response_model=ApiResponse)
async def put_config(body: ConfigIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    before = await wcfg.load_config(db, force=True)
    preview = wcfg.deep_merge(before, wcfg.sanitize(body.config, wcfg.DEFAULT_CONFIG))
    if preview["readiness"].get("target") not in ("test", "main"):
        raise HTTPException(status_code=400, detail="নম্বরের ধরন ‘পরীক্ষার’ বা ‘মূল’ হতে হবে")
    problem = wcfg.readiness_problem(preview)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    cfg = await wcfg.save_config(db, body.config)
    changed = [k for k in cfg if cfg[k] != before.get(k)]
    _audit(db, admin_id, "wa_config", values={"changed": changed})
    await db.commit()
    return ApiResponse(data={"config": cfg, "status_now": brain.current_status(cfg)}, message="সংরক্ষণ হয়েছে")


@router.post("/admin/wa/config/reset", response_model=ApiResponse)
async def reset_config(section: str = Query(max_length=40), db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    try:
        cfg = await wcfg.reset_section(db, section)
    except KeyError:
        raise HTTPException(status_code=400, detail="এই অংশ চেনা যায়নি")
    _audit(db, admin_id, "wa_config_reset", values={"section": section})
    await db.commit()
    return ApiResponse(data={"config": cfg}, message="আগের ডিফল্টে ফেরানো হয়েছে")


@router.get("/admin/wa/setup", response_model=ApiResponse)
async def setup(db: AsyncSession = Depends(get_db), _a: str = Depends(require_role(OWNER))):
    verify_token = await wcfg.ensure_verify_token(db)
    creds = await wcfg.get_secrets(db)
    cfg = await wcfg.load_config(db)
    seen = (await flow._get_val(db, "cron_seen_wa")) or None
    return ApiResponse(data={
        "webhook_url": f"{_api_base()}/api/v1/wa/webhook", "verify_token": verify_token,
        "cron_url": f"{_api_base()}/api/v1/wa/cron?token={cron_token()}", "cron_seen_at": seen,
        "secrets": wcfg.masked(creds), "readiness": cfg["readiness"], "readiness_labels": wcfg.READINESS_LABELS,
        "steps": {"meta": wa_send.ready(creds), "secret": bool(creds.get("app_secret")), "cron": bool(seen), "enabled": bool(cfg.get("enabled"))},
    })


@router.get("/admin/wa/health", response_model=ApiResponse)
async def health(remote: bool = Query(False), db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The setup panel's real checks. `remote=true` also makes a few read-only calls to Meta."""
    return ApiResponse(data=await wa_health.build(db, remote))


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    contact_id: uuid.UUID | None = None


class SuggestIn(BaseModel):
    instruction: str = Field(default="", max_length=300)


@router.post("/admin/wa/ask", response_model=ApiResponse, dependencies=[Depends(rate_limit("wa-ai", 40, 300))])
async def ask_ai(body: AskIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The owner's AI helper: answers from a short summary of his own messages and tasks (read-only)."""
    from app.assistant import ai_hub, wa_ai

    try:
        return ApiResponse(data={"answer": await wa_ai.ask(db, body.question.strip(), body.contact_id)})
    except ai_hub.HubError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message_bn)


@router.post("/admin/wa/contacts/{cid}/suggest", response_model=ApiResponse, dependencies=[Depends(rate_limit("wa-ai", 40, 300))])
async def suggest(cid: uuid.UUID, body: SuggestIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """A draft reply for one person, written for the owner to read, change and send himself."""
    from app.assistant import ai_hub, wa_ai

    try:
        return ApiResponse(data=await wa_ai.suggest_reply(db, cid, body.instruction.strip()))
    except LookupError:
        raise HTTPException(status_code=404, detail="ব্যক্তি পাওয়া যায়নি")
    except ai_hub.HubError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message_bn)


@router.get("/admin/wa/events", response_model=ApiResponse)
async def events(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The last things Meta sent to the webhook (kind only, no message text) — to see what really arrives."""
    return ApiResponse(data=await wa_health.recent_events(db))


async def _bind_webhook(db: AsyncSession, creds: dict[str, str]) -> tuple[bool, str]:
    """Tell Meta, for THIS WhatsApp account only, to send its events straight to our webhook address (override callback)."""
    verify_token = await wcfg.ensure_verify_token(db)
    ok, res = await wa_send.graph_post(creds, f"{creds['waba_id']}/subscribed_apps",
                                       {"override_callback_uri": f"{_api_base()}/api/v1/wa/webhook", "verify_token": verify_token})
    if ok:
        return True, ""
    e = res["error"]
    return False, f"{wa_send.explain(e)} (Meta বলেছে: {e.get('message') or e.get('status')})"


@router.post("/admin/wa/webhook/connect", response_model=ApiResponse)
async def connect_webhook(db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    """Same as the automatic step after saving credentials — as a manual button, for when real messages do not arrive."""
    creds = await wcfg.get_secrets(db)
    if not (wa_send.ready(creds) and creds.get("waba_id")):
        raise HTTPException(status_code=400, detail="আগে Phone Number ID, Access Token ও WhatsApp Business Account ID বসান")
    ok, why = await _bind_webhook(db, creds)
    _audit(db, admin_id, "wa_connect_webhook", values={"ok": ok})
    await db.commit()
    if not ok:
        raise HTTPException(status_code=502, detail=why)
    return ApiResponse(data={"ok": True}, message="Meta-কে বলা হয়েছে: এই অ্যাকাউন্টের সব ঘটনা সরাসরি আমাদের ঠিকানায় পাঠাও। এক মিনিট পর কার্ডে “এখনই পরীক্ষা করুন” চাপুন।")


@router.put("/admin/wa/secrets", response_model=ApiResponse)
async def put_secrets(body: SecretsIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    data = await wcfg.save_secrets(db, body.model_dump())
    _audit(db, admin_id, "wa_secrets", values={"fields": [k for k, v in body.model_dump().items() if v]})
    await db.commit()
    note = ""
    if (body.token or body.waba_id) and data.get("token") and data.get("waba_id"):
        ok, why = await _bind_webhook(db, data)  # automatic: no separate button press needed any more
        note = " · Webhook নিজে থেকে যুক্ত হয়েছে" if ok else f" · Webhook নিজে যুক্ত হয়নি: {why}"
    return ApiResponse(data={"secrets": wcfg.masked(data)}, message="গোপনভাবে সংরক্ষণ হয়েছে" + note)


@router.post("/admin/wa/secrets/test", response_model=ApiResponse)
async def test_secrets(db: AsyncSession = Depends(get_db), _a: str = Depends(require_role(OWNER))):
    return ApiResponse(data=await wa_send.check(await wcfg.get_secrets(db)))


# ── overview / inbox ────────────────────────────────────────────────────────────

@router.get("/admin/wa/overview", response_model=ApiResponse)
async def overview(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    cfg = await wcfg.load_config(db)
    now = _now()
    # three queries (one per table) instead of eight: conditional counts
    waiting_c = (WaContact.unread > 0) & (WaContact.state != "done")
    waiting, urgent = (await db.execute(select(
        func.count().filter(waiting_c), func.count().filter(waiting_c & WaContact.priority.in_((1, 2, 4)))).select_from(WaContact))).one()
    drafts, queued, failed = (await db.execute(select(
        func.count().filter(WaMessage.status == "draft"), func.count().filter(WaMessage.status == "queued"),
        func.count().filter((WaMessage.status == "failed") & (WaMessage.created_at >= now - timedelta(days=1)))).select_from(WaMessage)
        .where(WaMessage.status.in_(("draft", "queued", "failed"))))).one()
    tasks_open, tasks_late = (await db.execute(select(
        func.count(), func.count().filter(WaTask.due_at.isnot(None) & (WaTask.due_at < now))).select_from(WaTask).where(WaTask.is_done == False))).one()  # noqa: E712
    closing = (await db.execute(select(WaContact).where(
        WaContact.unread > 0, WaContact.state != "done", WaContact.last_inbound_at != None,  # noqa: E711
        WaContact.last_inbound_at < now - timedelta(hours=20), WaContact.last_inbound_at > now - timedelta(hours=24)).limit(10))).scalars().all()
    creds = await wcfg.get_secrets(db)
    return ApiResponse(data={
        "enabled": cfg["enabled"], "mode": cfg["mode"], "status_now": brain.current_status(cfg), "connected": wa_send.ready(creds),
        "waiting": waiting, "urgent": urgent, "drafts": drafts, "queued": queued, "failed_24h": failed,
        "tasks_open": tasks_open, "tasks_late": tasks_late, "window_closing": [_contact(c) for c in closing],
        "presence": await presence.summary(db),
        "alerts_held": (lambda h: {"count": len(h), "items": h[-5:]})(await alerts_mod.held_alerts(db)),
    })


@router.get("/admin/wa/contacts", response_model=ApiResponse)
async def contacts(view: str = Query("all", max_length=10), q: str = Query("", max_length=60), page: int = Query(1, ge=1, le=500),
                   src: str = Query("", max_length=300),
                   db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    preview = select(func.coalesce(WaMessage.transcript, WaMessage.body)).where(WaMessage.contact_id == WaContact.id) \
        .order_by(WaMessage.created_at.desc()).limit(1).scalar_subquery()
    stmt = select(WaContact, preview)
    if view == "urgent":
        stmt = stmt.where(WaContact.unread > 0, WaContact.state != "done", WaContact.priority.in_((1, 2, 4)))
    elif view == "waiting":
        stmt = stmt.where(WaContact.unread > 0, WaContact.state != "done")
    elif view == "owner":
        stmt = stmt.where(WaContact.state == "owner")
    elif view == "done":
        stmt = stmt.where(WaContact.state == "done")
    elif view == "drafts":  # people with a reply waiting for the owner's approval
        stmt = stmt.where(WaContact.id.in_(select(WaMessage.contact_id).where(WaMessage.status == "draft")))
    elif view == "failed":  # people whose reply could not be sent in the last day: the "N replies failed" warning opens this
        stmt = stmt.where(WaContact.id.in_(select(WaMessage.contact_id).where(WaMessage.status == "failed", WaMessage.created_at >= _now() - timedelta(days=1))))
    elif view == "blocked":
        stmt = stmt.where(WaContact.is_blocked == True)  # noqa: E712
    elif view in ("business", "personal", "social", "spam"):
        stmt = stmt.where(WaContact.category == view)
    elif view == "family":
        stmt = stmt.where(WaContact.is_family == True)  # noqa: E712
    elif view == "vip":
        stmt = stmt.where(WaContact.is_vip == True)  # noqa: E712
    elif view == "work":  # business: people asking about new work
        stmt = stmt.where(WaContact.priority == 3, WaContact.state != "done")
    # One module = one or more sources: a channel ("telegram") or one phone app's chats ("notif:com.whatsapp").
    tokens = [t.strip() for t in src.split(",") if t.strip()][:12]
    if tokens:
        conds = []
        for t in tokens:
            if t.startswith("notif:"):
                conds.append(WaContact.phone.like(f"{t.replace('%', '').replace('_', '')}:%"))
            else:
                conds.append(WaContact.channel == t)
        stmt = stmt.where(or_(*conds))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(WaContact.name.ilike(like), WaContact.phone.like(like), WaContact.need.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by((WaContact.unread > 0).desc(), WaContact.priority, WaContact.last_message_at.desc().nullslast())
                             .offset((page - 1) * 30).limit(30))).all()
    return ApiResponse(data={"items": [_contact(c, p) for c, p in rows], "total": total, "page": page})


@router.get("/admin/wa/contacts/{cid}", response_model=ApiResponse)
async def contact_detail(cid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    msgs = (await db.execute(select(WaMessage).where(WaMessage.contact_id == cid).order_by(WaMessage.created_at.desc()).limit(80))).scalars().all()
    notes = (await db.execute(select(WaNote).where(WaNote.contact_id == cid).order_by(WaNote.created_at.desc()).limit(30))).scalars().all()
    tasks = (await db.execute(select(WaTask).where(WaTask.contact_id == cid).order_by(WaTask.is_done, WaTask.due_at.asc().nullslast()).limit(30))).scalars().all()
    if c.unread:
        c.unread = 0
        await db.commit()
    return ApiResponse(data={
        "contact": _contact(c), "messages": [_message(m) for m in reversed(msgs)],
        "notes": [{"id": str(n.id), "text": n.text, "until": _iso(n.until), "is_active": n.is_active} for n in notes],
        "tasks": [{"id": str(t.id), "title": t.title, "due_at": _iso(t.due_at), "is_done": t.is_done, "source": t.source} for t in tasks]})


class TagIn(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    value: str = Field(default="", max_length=200)
    important: bool = False


class ContactPatch(BaseModel):
    tags: list[TagIn] | None = Field(default=None, max_length=12)
    name: str | None = Field(default=None, max_length=120)
    calls_him: str | None = Field(default=None, max_length=40)
    relation: str | None = Field(default=None, max_length=40)
    gender: str | None = Field(default=None, pattern="^(male|female|unknown)?$")
    mode: str | None = Field(default=None, pattern="^(inherit|auto|draft|notify|telegram)$")
    is_vip: bool | None = None
    is_family: bool | None = None
    is_blocked: bool | None = None
    state: str | None = Field(default=None, pattern="^(assistant|owner|done)$")
    category: str | None = Field(default=None, pattern="^(business|personal|social|spam)?$")


@router.patch("/admin/wa/contacts/{cid}", response_model=ApiResponse)
async def patch_contact(cid: uuid.UUID, body: ContactPatch, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    data = body.model_dump(exclude_unset=True)
    if "tags" in data:
        data["tags"] = [{"label": t["label"].strip(), "value": t["value"].strip(), "important": bool(t["important"])} for t in (data["tags"] or []) if t["label"].strip()]
    for k, v in data.items():
        setattr(c, k, v)
    if privacy.is_private(c):
        await privacy.seal_contact_messages(db, c.id)
    if data.get("state") == "owner":
        c.hold_until = _now() + timedelta(hours=int((await wcfg.load_config(db)).get("hold_hours", 12)))
    elif "state" in data:
        c.hold_until = None
        if data["state"] == "done":
            c.unread = 0
    _audit(db, admin_id, "wa_contact", c.id, {k: v for k, v in data.items() if k != "name"})
    await db.commit()
    return ApiResponse(data=_contact(c), message="সংরক্ষণ হয়েছে")


@router.delete("/admin/wa/contacts/{cid}", response_model=ApiResponse)
async def erase_contact(cid: uuid.UUID, db: AsyncSession = Depends(get_db), admin_id: str = Depends(require_role(OWNER))):
    c = await _get_contact(db, cid)
    _audit(db, admin_id, "wa_contact_erase", c.id)
    await db.delete(c)  # messages and notes go with it (ON DELETE CASCADE)
    await db.commit()
    return ApiResponse(data={"ok": True}, message="এই ব্যক্তির সব তথ্য মুছে ফেলা হয়েছে")


# ── replies ─────────────────────────────────────────────────────────────────────

class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=3000)


@router.post("/admin/wa/contacts/{cid}/reply", response_model=ApiResponse)
async def owner_reply(cid: uuid.UUID, body: TextIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    m = WaMessage(contact_id=c.id, direction="out", kind="text", body=body.text.strip(), reason="owner", status="queued", send_after=_now())
    db.add(m)
    c.state, c.unread = "owner", 0
    c.hold_until = _now() + timedelta(hours=int((await wcfg.load_config(db)).get("hold_hours", 12)))
    c.last_message_at = _now()
    await _promise_task(db, c, m.body)
    await db.commit()
    ok = await flow.deliver(db, m.id)
    await db.refresh(m)
    return ApiResponse(data=_message(m), message="পাঠানো হয়েছে" if ok else (m.error or "পাঠানো যায়নি"))


async def _promise_task(db: AsyncSession, contact: WaContact | None, text: str | None) -> None:
    """The owner's own commitment ("কাল পাঠাব") becomes a task. Never blocks sending."""
    try:
        from app.assistant import promises
        await promises.track_promise(db, contact, text or "")
    except Exception:  # noqa: BLE001
        pass


@router.post("/admin/wa/contacts/{cid}/sent-by-hand", response_model=ApiResponse)
async def sent_by_hand(cid: uuid.UUID, body: TextIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    """The owner sent this answer himself in the chat app ("open the chat" button). Keep the thread whole: record it as sent by the
    owner, drop the assistant's waiting draft, and let the assistant step back for a while. Nothing is sent from here."""
    c = await _get_contact(db, cid)
    now = _now()
    for d in (await db.execute(select(WaMessage).where(WaMessage.contact_id == c.id, WaMessage.direction == "out", WaMessage.status.in_(("draft", "failed"))))).scalars().all():
        d.status = "discarded"
    db.add(WaMessage(contact_id=c.id, direction="out", kind="text", body=body.text.strip(), reason="owner", status="sent", delivery="manual",
                     sent_at=now, meta={"via": "by-hand"}))
    c.state, c.unread = "owner", 0
    c.hold_until = now + timedelta(hours=int((await wcfg.load_config(db)).get("hold_hours", 12)))
    c.last_message_at = c.last_outbound_at = now
    await _promise_task(db, c, body.text)
    await db.commit()
    return ApiResponse(message="চ্যাটে লিখে রাখা হলো")


@router.post("/admin/wa/messages/{mid}/approve", response_model=ApiResponse)
async def approve(mid: uuid.UUID, body: TextIn | None = None, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    m = await db.get(WaMessage, mid)
    if not m or m.direction != "out" or m.status not in ("draft", "failed"):  # failed = "আবার পাঠান"
        raise HTTPException(status_code=404, detail="এই বার্তা আর পাঠানোর অপেক্ষায় নেই")
    m.error = None
    if body and body.text.strip():
        m.meta = {**(m.meta or {}), "edited": True}
        m.body = body.text.strip()
    m.status, m.send_after = "queued", _now()
    await _promise_task(db, await db.get(WaContact, m.contact_id), m.body)
    await db.commit()
    ok = await flow.deliver(db, m.id)
    await db.refresh(m)
    return ApiResponse(data=_message(m), message="পাঠানো হয়েছে" if ok else (m.error or "পাঠানো যায়নি"))


@router.post("/admin/wa/messages/{mid}/discard", response_model=ApiResponse)
async def discard(mid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    m = await db.get(WaMessage, mid)
    if not m or m.status not in ("draft", "queued"):
        raise HTTPException(status_code=404, detail="এই বার্তা আর অপেক্ষায় নেই")
    m.status = "discarded"
    await db.commit()
    return ApiResponse(data=_message(m), message="বাদ দেওয়া হয়েছে")


class FeedbackIn(BaseModel):
    good: bool


@router.post("/admin/wa/messages/{mid}/feedback", response_model=ApiResponse)
async def feedback(mid: uuid.UUID, body: FeedbackIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    m = await db.get(WaMessage, mid)
    if not m:
        raise HTTPException(status_code=404, detail="বার্তা পাওয়া যায়নি")
    m.feedback = 1 if body.good else -1
    await db.commit()
    return ApiResponse(data={"feedback": m.feedback})


# ── notes & tasks ───────────────────────────────────────────────────────────────

class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    until: datetime | None = None


@router.post("/admin/wa/contacts/{cid}/notes", response_model=ApiResponse)
async def add_note(cid: uuid.UUID, body: NoteIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    await _get_contact(db, cid)
    n = WaNote(contact_id=cid, text=body.text.strip(), until=body.until)
    db.add(n)
    await db.commit()
    return ApiResponse(data={"id": str(n.id)}, message="নোট রাখা হয়েছে — এই ব্যক্তি লিখলে সহকারী এটাই জানাবে")


@router.delete("/admin/wa/notes/{nid}", response_model=ApiResponse)
async def remove_note(nid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    n = await db.get(WaNote, nid)
    if n:
        await db.delete(n)
        await db.commit()
    return ApiResponse(data={"ok": True})


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_at: datetime | None = None
    contact_id: uuid.UUID | None = None


@router.get("/admin/wa/tasks", response_model=ApiResponse)
async def tasks(show: str = Query("open", max_length=6), db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    stmt = select(WaTask, WaContact.name, WaContact.phone).outerjoin(WaContact, WaContact.id == WaTask.contact_id)
    stmt = stmt.where(WaTask.is_done == (show == "done")).order_by(WaTask.due_at.asc().nullslast(), WaTask.created_at.desc()).limit(100)
    return ApiResponse(data=[{"id": str(t.id), "title": t.title, "due_at": _iso(t.due_at), "is_done": t.is_done, "source": t.source,
                              "contact_id": str(t.contact_id) if t.contact_id else None, "who": n or p, "contact_name": n,
                              "late": bool(t.due_at and not t.is_done and t.due_at < _now()), "proposed": t.source == "proposed"} for t, n, p in (await db.execute(stmt)).all()])


@router.post("/admin/wa/tasks", response_model=ApiResponse)
async def add_task(body: TaskIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    t = WaTask(title=body.title.strip(), due_at=body.due_at, contact_id=body.contact_id, source="manual")
    db.add(t)
    await db.commit()
    return ApiResponse(data={"id": str(t.id)}, message="কাজ যোগ হয়েছে")


class F0In(BaseModel):
    text: str = Field(min_length=1, max_length=600)


@router.post("/admin/wa/f0/command", response_model=ApiResponse, dependencies=[Depends(rate_limit("wa-f0", 60, 300))])
async def f0_command(body: F0In, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The owner's command box. Reads real data; a "tell X ..." command only makes a DRAFT, sending stays on /messages/{id}/approve."""
    return ApiResponse(data=await f0_mod.run(db, body.text))


class FactIn(BaseModel):
    text: str = Field(min_length=3, max_length=300)


@router.get("/admin/wa/contacts/{cid}/facts", response_model=ApiResponse)
async def contact_facts(cid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    return ApiResponse(data=memory.view(c.profile, privacy.unseal))


def _seal_fact_text(c: WaContact, text: str) -> str:
    return privacy.seal(text) if privacy.is_private(c) else text  # a private person's facts are stored encrypted like their messages


@router.post("/admin/wa/contacts/{cid}/facts", response_model=ApiResponse)
async def add_fact(cid: uuid.UUID, body: FactIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    existing = [{**f, "text": privacy.unseal(f.get("text", ""))} for f in memory.facts_of(c.profile)]
    prof, fact, why = memory.add({**(c.profile or {}), "facts": existing}, body.text, "owner", "owner")
    if not fact:
        return ApiResponse(data=None, message=why)
    c.profile = {**prof, "facts": [{**f, "text": _seal_fact_text(c, f["text"])} for f in prof["facts"]]}
    await db.commit()
    return ApiResponse(data={"id": fact["id"]}, message="তথ্যটি আপনার নিজের বলে মনে রাখা হলো")


@router.post("/admin/wa/contacts/{cid}/facts/{fid}/correct", response_model=ApiResponse)
async def correct_fact(cid: uuid.UUID, fid: str, body: FactIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    plain = {**(c.profile or {}), "facts": [{**f, "text": privacy.unseal(f.get("text", "")), "history": [{**h, "was": privacy.unseal(h["was"]) if h.get("was") else h.get("was")} for h in f.get("history", [])]} for f in memory.facts_of(c.profile)]}
    prof, new = memory.correct(plain, fid, body.text)
    if not new:
        raise HTTPException(status_code=404, detail="তথ্য পাওয়া যায়নি")
    c.profile = {**prof, "facts": [{**f, "text": _seal_fact_text(c, f["text"]), "history": [{**h, "was": _seal_fact_text(c, h["was"]) if h.get("was") else h.get("was")} for h in f.get("history", [])]} for f in prof["facts"]]}
    await db.commit()
    return ApiResponse(data={"id": new["id"]}, message="সংশোধন হলো, পুরোনোটি ইতিহাসে আছে")


@router.delete("/admin/wa/contacts/{cid}/facts/{fid}", response_model=ApiResponse)
async def delete_fact(cid: uuid.UUID, fid: str, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    prof, removed = memory.remove(c.profile, fid)
    if not removed:
        raise HTTPException(status_code=404, detail="তথ্য পাওয়া যায়নি")
    c.profile = prof
    await db.commit()
    return ApiResponse(message="তথ্যটি সম্পূর্ণ মুছে ফেলা হলো")


@router.get("/admin/wa/contacts/{cid}/relationship", response_model=ApiResponse)
async def contact_relationship(cid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """Signs, not scores: every line is a hypothesis with the evidence it rests on (the whole linked person, all channels)."""
    c = await _get_contact(db, cid)
    msgs = await flow.recent_messages(db, await identity.person_contact_ids(db, c), 400)
    return ApiResponse(data={"observations": relationship.observe(msgs, _now()), "note": "এগুলো অনুমান, নিশ্চিত তথ্য নয়"})


class LinkIn(BaseModel):
    contact_ids: list[uuid.UUID] = Field(min_length=2, max_length=6)


def _who(c: WaContact) -> dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "channel": c.channel, "key": c.phone.split(":", 1)[-1] if ":" in c.phone else c.phone}


async def _identity_ready(db: AsyncSession) -> None:
    if not await identity.column_ready(db):
        raise HTTPException(status_code=409, detail="পরিচয় যুক্ত করার জন্য ডাটাবেসে manual_sql/0002 এখনো চালানো হয়নি")


@router.get("/admin/wa/identity/suggestions", response_model=ApiResponse)
async def identity_suggestions(db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """People who may be the SAME human on different channels. Medium confidence = only a suggestion, the owner decides."""
    await _identity_ready(db)
    contacts = (await db.execute(select(WaContact).where(WaContact.name.isnot(None)).limit(2000))).scalars().all()
    pairs = identity.suggestions(contacts, await identity.group_contact_ids(db), await identity.person_map(db))
    return ApiResponse(data=[{"a": _who(p["a"]), "b": _who(p["b"]), "level": p["level"], "reasons": p["reasons"]} for p in pairs[:50]])


@router.post("/admin/wa/identity/link", response_model=ApiResponse)
async def identity_link(body: LinkIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The owner says these contacts are one human. Refused for groups and for contacts whose phone numbers differ."""
    await _identity_ready(db)
    ids = list(dict.fromkeys(body.contact_ids))
    contacts = [await _get_contact(db, i) for i in ids]
    groups = await identity.group_contact_ids(db)
    if any(c.id in groups for c in contacts):
        raise HTTPException(status_code=422, detail="গ্রুপ চ্যাট কোনো ব্যক্তির সঙ্গে যুক্ত করা যায় না")
    numbers = {identity.number_of(c.phone) for c in contacts} - {None}
    if len(numbers) > 1:
        raise HTTPException(status_code=422, detail="এই দুই জনের ফোন নম্বর আলাদা, তাই একজন ব্যক্তি হিসেবে যুক্ত করা হলো না")
    pid = await identity.link(db, contacts, "owner", "মালিকের নিশ্চিতকরণ")
    await db.commit()
    return ApiResponse(data={"person_id": str(pid), "contacts": [_who(c) for c in contacts]}, message="একজন ব্যক্তি হিসেবে যুক্ত হলো (আবার আলাদা করা যাবে)")


@router.post("/admin/wa/identity/unlink/{cid}", response_model=ApiResponse)
async def identity_unlink(cid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    await _identity_ready(db)
    await _get_contact(db, cid)
    done = await identity.unlink(db, cid, "owner")
    await db.commit()
    return ApiResponse(data={"unlinked": done}, message="আলাদা করা হলো, কোনো বার্তা বা কাজ মোছা হয়নি" if done else "এটি কারও সঙ্গে যুক্ত ছিল না")


@router.get("/admin/wa/contacts/{cid}/identity", response_model=ApiResponse)
async def contact_identity(cid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    ids = await identity.person_contact_ids(db, c)
    rows = (await db.execute(select(WaContact).where(WaContact.id.in_(ids)))).scalars().all()
    return ApiResponse(data={"linked": [_who(r) for r in rows if r.id != c.id]})


class ProgressIn(BaseModel):
    status: str | None = Field(default=None, max_length=12)
    progress: str | None = Field(default=None, max_length=500)
    blocker: str | None = Field(default=None, max_length=500)


@router.post("/admin/wa/tasks/{tid}/progress", response_model=ApiResponse)
async def task_progress(tid: uuid.UUID, body: ProgressIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """The owner records progress / a blocker / a status. Only the owner can: completion is his confirmation, never a guess."""
    t = await db.get(WaTask, tid)
    if not t:
        raise HTTPException(status_code=404, detail="কাজ পাওয়া যায়নি")
    if body.status and body.status not in task_details.STATUSES:
        raise HTTPException(status_code=422, detail="অবস্থার নাম ঠিক নয়")
    if not await task_details.ready(db):
        raise HTTPException(status_code=409, detail="অগ্রগতি রাখার জন্য ডাটাবেসে manual_sql/0003 এখনো চালানো হয়নি")
    await task_details.set_details(db, t.id, status=body.status, progress=body.progress, blocker=body.blocker)
    if body.status == "completed":
        t.is_done, t.done_at = True, _now()
    elif body.status in ("in_progress", "not_started", "blocked", "delayed") and t.is_done:
        t.is_done, t.done_at = False, None
    if t.source == "proposed" and body.status and body.status != "proposed":
        t.source = "confirmed"  # the owner working on it IS his confirmation
    await db.commit()
    return ApiResponse(message="কাজের অবস্থা হালনাগাদ হলো")


@router.post("/admin/wa/tasks/{tid}/confirm", response_model=ApiResponse)
async def confirm_task(tid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    """A task the assistant only PROPOSED (someone asked the owner for something) becomes a real obligation by the owner's word."""
    t = await db.get(WaTask, tid)
    if not t:
        raise HTTPException(status_code=404, detail="কাজ পাওয়া যায়নি")
    if t.source != "proposed":
        return ApiResponse(data={"source": t.source}, message="এটি আগেই নিশ্চিত বা আপনার নিজের লেখা কাজ")
    t.source = "confirmed"
    await db.commit()
    return ApiResponse(data={"source": t.source}, message="কাজটি নিশ্চিত করা হলো")


@router.post("/admin/wa/tasks/{tid}/toggle", response_model=ApiResponse)
async def toggle_task(tid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    t = await db.get(WaTask, tid)
    if not t:
        raise HTTPException(status_code=404, detail="কাজ পাওয়া যায়নি")
    t.is_done = not t.is_done
    t.done_at = _now() if t.is_done else None
    await db.commit()
    return ApiResponse(data={"is_done": t.is_done})


@router.delete("/admin/wa/tasks/{tid}", response_model=ApiResponse)
async def remove_task(tid: uuid.UUID, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    t = await db.get(WaTask, tid)
    if t:
        await db.delete(t)
        await db.commit()
    return ApiResponse(data={"ok": True})


# ── simulator (nothing is stored or sent) ───────────────────────────────────────

class SimIn(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    contact_id: uuid.UUID | None = None
    name: str = Field(default="", max_length=80)
    kind: str = Field(default="text", pattern="^(text|audio)$")
    use_ai: bool = True
    status_key: str | None = Field(default=None, max_length=30)
    note: str = Field(default="", max_length=600)


@router.post("/admin/wa/simulate", response_model=ApiResponse)
async def simulate(body: SimIn, db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    cfg = await wcfg.load_config(db, force=True)
    if not body.use_ai:
        cfg["ai"]["enabled"] = False
    if body.status_key:
        cfg["status"] = {"key": body.status_key, "until": None, "custom": ""}
    recent: list[dict[str, Any]] = []
    notes = [body.note.strip()] if body.note.strip() else []
    c: Any
    if body.contact_id:
        c = await _get_contact(db, body.contact_id)
        recent = await flow.recent_messages(db, c.id)
        notes += await flow.active_notes(db, c.id)
    else:
        c = SimpleNamespace(name=body.name or None, lang=None, is_blocked=False, state="assistant", hold_until=None, mode="inherit",
                            is_family=False, is_vip=False, profile=None)
    d = await brain.decide(db, cfg, c, body.text, body.kind, None, recent, notes)
    mode = "auto" if cfg["mode"] == "auto" and getattr(c, "mode", "inherit") != "draft" else "draft"
    action = "silent" if not d.reply else ("send" if (mode == "auto" and cfg["enabled"]) else "draft")
    return ApiResponse(data={"reply": d.reply, "reason": d.reason, "priority": d.priority, "kind": d.kind, "summary": d.summary, "need": d.need,
                             "notify": d.notify, "handoff": d.handoff, "lang": d.lang, "ai_used": d.ai_used, "tasks": d.tasks,
                             "note": d.note, "action": action, "status_now": brain.current_status(cfg)})


# ── learn a person from an exported chat ────────────────────────────────────────

class ImportIn(BaseModel):
    chat_text: str = Field(min_length=20, max_length=2_000_000)
    owner_speaker: str | None = Field(default=None, max_length=80)
    days: int = Field(default=7)  # 0 = everything in the file; else 1, 3, 5, 7, 15 or 30
    consent_private: bool = False


@router.post("/admin/wa/contacts/{cid}/import-history", response_model=ApiResponse)
async def import_history(cid: uuid.UUID, body: ImportIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    """Old messages from a chat the owner exported himself. Context only: never answered, never alerted, safe to run again (no duplicates)."""
    c = await _get_contact(db, cid)
    if body.days not in history_import.PERIODS:
        raise HTTPException(status_code=422, detail="সময়সীমা ঠিক নয়: ১, ৩, ৫, ৭, ১৫, ৩০ দিন অথবা ০ (ফাইলের সবটুকু)")
    if privacy.is_private(c) and not body.consent_private:
        return ApiResponse(data={"need_consent": True}, message="এটি ব্যক্তিগত/পরিবারের চ্যাট — ইতিহাস রাখতে আপনার স্পষ্ট অনুমতি লাগবে")
    rows, stats = history_import.parse_dated(body.chat_text)
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="চ্যাট ফাইলটি চেনা যায়নি — WhatsApp → চ্যাট → Export chat (মিডিয়া ছাড়া) থেকে নেওয়া .txt ফাইলের লেখা দিন")
    speakers = history_import.speakers_of(rows)
    if not body.owner_speaker or body.owner_speaker not in speakers:
        return ApiResponse(data={"need_owner": True, "speakers": speakers[:6], "messages": len(rows)}, message="কোনটি আপনার নাম বেছে দিন")
    cfg = await wcfg.load_config(db)
    rep = await history_import.import_rows(db, c, rows, body.owner_speaker, body.days, int(cfg.get("retention_days", 90)), _now())
    rep.update(system_lines=stats["system"], undated=stats["undated"])
    _audit(db, admin_id, "wa_import_history", c.id, {k: rep[k] for k in ("found", "imported", "duplicates")})
    await db.commit()
    return ApiResponse(data=rep, message=f"{rep['imported']}টি নতুন বার্তা ইতিহাসে রাখা হলো, {rep['duplicates']}টি আগেই ছিল")


class LearnIn(BaseModel):
    chat_text: str = Field(min_length=20, max_length=400_000)
    owner_speaker: str | None = Field(default=None, max_length=80)
    consent_private: bool = False  # family/personal chats are only read by the AI when the owner says so, each time


@router.post("/admin/wa/contacts/{cid}/learn", response_model=ApiResponse)
async def learn(cid: uuid.UUID, body: LearnIn, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    c = await _get_contact(db, cid)
    if privacy.is_private(c) and not body.consent_private:
        return ApiResponse(data={"need_consent": True}, message="এটি ব্যক্তিগত/পরিবারের চ্যাট — AI-কে পড়তে দিতে আপনার স্পষ্ট অনুমতি লাগবে")
    rows, speakers = brain.parse_export(body.chat_text)
    if len(rows) < 3:
        raise HTTPException(status_code=400, detail="চ্যাট ফাইলটি চেনা যায়নি — WhatsApp → চ্যাট → Export chat (মিডিয়া ছাড়া) থেকে নেওয়া .txt ফাইলের লেখা দিন")
    if not body.owner_speaker or body.owner_speaker not in speakers:
        return ApiResponse(data={"need_owner": True, "speakers": speakers[:6], "messages": len(rows)}, message="কোনটি আপনার নাম বেছে দিন")
    try:
        prof = await brain.learn_profile(db, rows, body.owner_speaker)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="এই মুহূর্তে AI পাওয়া যাচ্ছে না — Admin → AI সংযোগ দেখে আবার চেষ্টা করুন")
    prof["learned_at"], prof["messages"] = _now().isoformat(timespec="minutes"), len(rows)
    c.profile = {**prof, **({"facts": c.profile["facts"]} if (c.profile or {}).get("facts") else {})}  # only this summary is kept (the chat text itself is never stored); the owner's remembered facts survive
    for field in ("calls_him", "relation", "gender"):
        if prof.get(field) and not getattr(c, field):
            setattr(c, field, str(prof[field])[:40])
    if prof.get("sensitive"):
        c.is_family = c.is_family or prof.get("relation") == "family"
    _audit(db, admin_id, "wa_learn", c.id, {"messages": len(rows)})
    await db.commit()
    return ApiResponse(data={"profile": prof, "contact": _contact(c)}, message="ব্যক্তিটিকে চেনা হয়েছে — চ্যাটের লেখা সংরক্ষণ করা হয়নি")


@router.get("/admin/wa/contacts/{cid}/export", response_model=ApiResponse)
async def export_chat(cid: uuid.UUID, db: AsyncSession = Depends(get_db), admin_id: str = Depends(owner_or_device(OWNER))):
    """This person's whole saved chat as plain text, in the same shape WhatsApp's own "Export chat" uses (so it can be imported again)."""
    c = await _get_contact(db, cid)
    msgs = (await db.execute(select(WaMessage).where(WaMessage.contact_id == cid, WaMessage.status.notin_(("draft", "discarded"))).order_by(WaMessage.created_at))).scalars().all()
    who = (c.name or c.phone.split(":")[-1])[:60].replace(":", " ")
    sumon, lines = "Sumon", []  # the assistant's own replies carry another name so a re-import never learns the owner's style from them
    for m in msgs:
        text = (privacy.unseal(m.transcript or m.body) or "").replace("\n", " ").strip()
        if text:
            lines.append(f"{m.created_at.astimezone(brain.DHAKA):%d/%m/%Y, %H:%M} - {(sumon if m.reason in ('owner', 'manual') else 'Assistant') if m.direction == 'out' else who}: {text}")
    _audit(db, admin_id, "wa_export_chat", c.id, {"messages": len(lines)})
    await db.commit()
    return ApiResponse(data={"filename": f"chat-{who}.txt".replace(" ", "_")[:80], "text": "\n".join(lines), "messages": len(lines)})


# ── weekly report ───────────────────────────────────────────────────────────────

REPORT_CAP = 20000


@router.get("/admin/wa/report", response_model=ApiResponse)
async def report(days: int = Query(7, ge=1, le=30), db: AsyncSession = Depends(get_db), _a: str = Depends(owner_or_device(OWNER))):
    since = _now() - timedelta(days=days)
    rows = (await db.execute(select(WaMessage.direction, WaMessage.status, WaMessage.reason, WaMessage.feedback, WaMessage.created_at, WaMessage.sent_at)
                             .where(WaMessage.created_at >= since, WaMessage.status != coexist.IMPORTED).limit(REPORT_CAP + 1))).all()
    truncated = len(rows) > REPORT_CAP
    rows = rows[:REPORT_CAP]
    per_day: dict[str, dict[str, int]] = {}
    counts = {"in": 0, "sent": 0, "draft": 0, "discarded": 0, "failed": 0, "good": 0, "bad": 0}
    by_reason: dict[str, int] = {}
    delays: list[float] = []
    for direction, status, reason, fb, created, sent in rows:
        day = created.astimezone(brain.DHAKA).date().isoformat()
        slot = per_day.setdefault(day, {"in": 0, "out": 0})
        if direction == "in":
            counts["in"] += 1
            slot["in"] += 1
            continue
        slot["out"] += 1
        if status in ("sent", "draft", "failed", "discarded"):
            counts[status] += 1
        if reason and reason not in ("owner", "manual"):
            by_reason[reason] = by_reason.get(reason, 0) + 1
            if sent and status == "sent":
                delays.append((sent - created).total_seconds())
        if fb == 1:
            counts["good"] += 1
        elif fb == -1:
            counts["bad"] += 1
    reviewed = counts["sent"] + counts["discarded"]
    return ApiResponse(data={"days": days, "counts": counts, "per_day": [{"day": k, **v} for k, v in sorted(per_day.items())],
                             "by_reason": by_reason, "avg_reply_seconds": round(sum(delays) / len(delays)) if delays else None,
                             "approval_rate": round(100 * counts["sent"] / reviewed) if reviewed else None,
                             "truncated": truncated})
