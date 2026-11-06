"""F0: the owner's command centre (Brain_Prompt section 12). One text box that understands what the owner types and answers from
the REAL stored data. It reuses everything that exists (contacts, identity links, tasks, reply-state, facts); it adds only the
parsing and the glue.

Safety, in the order the directive demands:
  * a command that would SEND something never sends: it makes a DRAFT (`reason="owner"`, `meta.via="f0"`) with warnings, and the
    owner approves it through the existing approve route; delivery success is reported by that route, not here;
  * more than one person matches  -> it asks "which one?" (choices) and does nothing else;
  * the owner already answered recently -> a warning is shown, nothing is hidden;
  * a blocked person is refused; the same command twice in a minute reuses the first draft (no duplicate);
  * nothing is invented: an empty answer says it is empty.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import assignments, identity, memory, privacy
from app.assistant import thread_state as ts
from app.assistant import wa_flow as flow
from app.assistant.call_context import is_call
from app.models.wa import WaContact, WaMessage, WaTask

UTC = timezone.utc
_ID = re.compile(r"\s#([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$", re.I)
_BN_REPLY = re.compile(r"^\s*(?P<name>\S+(?:\s\S+)?)\s*-?কে\s+(?:বলো|বল|বলুন|জানাও|জানিয়ে\s*দাও|লিখো|লিখে\s*দাও|পাঠাও)\s+(?P<msg>.+)$", re.S)
_EN_REPLY = re.compile(r"^\s*(?:tell|message|text|send)\s+(?P<name>\w+)\s+(?:that\s+)?(?P<msg>.+)$", re.I | re.S)
_BN_STATUS = re.compile(r"^\s*(?P<name>\S+?(?:\s\S+?)??)(?:ে?র|\s+এর)\s+কাজ(?:ের)?\s*(?:কী|কি)\s*হলো", re.S)  # "রহিমের" / "রহিম এর" / "ফজলুর"
_EN_STATUS = re.compile(r"(?:status|update)\s+(?:of|on|for)\s+(?P<name>\w+)(?:'s)?\s*(?:work|task)?|what\s+happened\s+to\s+(?P<name2>\w+)(?:'s)?\s+work", re.I)
_CALLS = re.compile(r"মিসড\s*কল|missed\s+calls?", re.I)
_PENDING = re.compile(r"উত্তর\s*বাকি|কার\s*উত্তর|কাদের\s*উত্তর|unanswered|pending\s+repl", re.I)
_TASKS = re.compile(r"আমার\s*(?:কাজ|টাস্ক)|কাজের\s*তালিকা|টাস্ক\s*(?:দেখাও|তালিকা)|my\s+tasks|open\s+tasks", re.I)
_MEMORY = re.compile(r"^\s*(?P<name>\S+(?:\s\S+)?)\s*(?:সম্পর্কে|বিষয়ে)\s*(?:কী|কি)\s*(?:জানো|মনে\s*আছে)|what\s+do\s+you\s+know\s+about\s+(?P<name2>\w+)", re.I)
_PERSON = re.compile(r"^\s*(?P<name>\S+(?:\s\S+)?)\s*কে\s*\??\s*$|who\s+is\s+(?P<name2>\w+)", re.I)
UNKNOWN_HELP = "বুঝতে পারিনি। যেমন লিখতে পারেন: “রহিমকে বলো কাল জানাব”, “রহিমের কাজের কী হলো”, “মিসড কল”, “কার উত্তর বাকি”, “আমার কাজ”, “রহিম সম্পর্কে কী জানো”"


def parse(text: str) -> dict[str, Any]:
    """{intent, name, msg, contact_id}. Pure; the first pattern that fits wins (a send-command beats everything else)."""
    t = (text or "").strip()
    cid = None
    m = _ID.search(t)
    if m:
        cid, t = m.group(1), t[:m.start()].strip()
    for rx, intent in ((_BN_REPLY, "reply"), (_EN_REPLY, "reply")):
        mm = rx.match(t)
        if mm:
            return {"intent": intent, "name": mm.group("name").strip(), "msg": mm.group("msg").strip(), "contact_id": cid}
    mem = _MEMORY.search(t)
    if mem:
        return {"intent": "memory", "name": (mem.group("name") or mem.group("name2")).strip(), "msg": "", "contact_id": cid}
    for rx in (_BN_STATUS, _EN_STATUS):
        mm = rx.search(t)
        if mm:
            return {"intent": "task_status", "name": (mm.groupdict().get("name") or mm.groupdict().get("name2") or "").strip(), "msg": "", "contact_id": cid}
    if _CALLS.search(t):
        return {"intent": "missed_calls", "name": "", "msg": "", "contact_id": cid}
    if _PENDING.search(t):
        return {"intent": "pending", "name": "", "msg": "", "contact_id": cid}
    if _TASKS.search(t):
        return {"intent": "tasks", "name": "", "msg": "", "contact_id": cid}
    mm = _PERSON.match(t)
    if mm:
        return {"intent": "person", "name": (mm.group("name") or mm.group("name2")).strip(), "msg": "", "contact_id": cid}
    return {"intent": "unknown", "name": "", "msg": "", "contact_id": cid}


def _reply(intent: str, answer: str, items=None, choices=None, draft=None) -> dict[str, Any]:
    return {"intent": intent, "answer": answer, "items": items or [], "choices": choices or [], "draft": draft}


def _label(c: WaContact) -> str:
    return f"{c.name or c.phone.split(':', 1)[-1]} ({(c.channel or 'whatsapp')})"


async def resolve(db: AsyncSession, name: str, contact_id: str | None) -> tuple[list[WaContact], list[dict[str, str]]]:
    """(contacts of the ONE person found, choices). Several different people -> ([], choices): the owner must pick."""
    if contact_id:
        try:
            c = await db.get(WaContact, uuid.UUID(contact_id))
        except ValueError:
            c = None
        if not c:
            return [], []
        ids = await identity.person_contact_ids(db, c)  # the same human on other channels counts too
        return list((await db.execute(select(WaContact).where(WaContact.id.in_(ids)))).scalars().all()) or [c], []
    if not name:
        return [], []
    rows = (await db.execute(select(WaContact).where(WaContact.name.ilike(f"%{name}%")).order_by(WaContact.last_message_at.desc().nullslast()).limit(20))).scalars().all()
    if not rows:
        return [], []
    pmap = await identity.person_map(db) if await identity.column_ready(db) else {}
    people: dict[Any, list[WaContact]] = {}
    for r in rows:
        people.setdefault(pmap.get(r.id) or r.id, []).append(r)
    if len(people) == 1:
        group = next(iter(people.values()))
        ids = await identity.person_contact_ids(db, group[0])
        return list((await db.execute(select(WaContact).where(WaContact.id.in_(ids)))).scalars().all()), []
    return [], [{"contact_id": str(g[0].id), "label": _label(g[0])} for g in list(people.values())[:6]]


def _best_channel(contacts: list[WaContact]) -> WaContact:
    return max(contacts, key=lambda c: c.last_inbound_at.timestamp() if c.last_inbound_at else 0)


async def _reply_draft(db: AsyncSession, contacts: list[WaContact], msg: str, now: datetime) -> dict[str, Any]:
    target = _best_channel(contacts)
    if any(c.is_blocked for c in contacts):
        return _reply("reply", "এই ব্যক্তি ব্লক করা, তাই কোনো খসড়া বানানো হয়নি")
    if len(msg) < 2:
        return _reply("reply", "কী বলতে হবে বুঝতে পারিনি, বার্তাটা আবার লিখুন")
    warnings: list[str] = []
    recent = await flow.recent_messages(db, [c.id for c in contacts], 30)
    st = ts.assess(recent)
    if st.owner_replied and st.status in ("adequate", "partial", "uncertain"):
        warnings.append("আপনি এই ব্যক্তিকে আগেই উত্তর দিয়েছেন (" + st.label + ") — আবার পাঠানো দরকার কি না দেখে নিন")
    if (target.channel or "whatsapp") == "whatsapp" and (not target.last_inbound_at or now - target.last_inbound_at > flow.WINDOW):
        warnings.append("২৪ ঘণ্টার বেশি হয়ে গেছে: WhatsApp-এ এখন আর সাধারণ বার্তা পাঠানো যাবে না")
    if privacy.is_private(target):
        warnings.append("ব্যক্তিগত/পরিবারের চ্যাট: পাঠানোর আগে নিজে পড়ে নিন")
    waiting = (await db.execute(select(WaMessage).where(WaMessage.contact_id == target.id, WaMessage.direction == "out", WaMessage.status == "draft")
                               .order_by(WaMessage.created_at.desc()).limit(1))).scalar_one_or_none()
    body = privacy.seal(msg) if privacy.is_private(target) else msg
    if waiting and (waiting.meta or {}).get("via") == "f0" and privacy.unseal(waiting.body) == msg:
        draft = waiting  # the same command again: reuse, never a second draft
    else:
        if waiting:
            warnings.append("এই ব্যক্তির জন্য আপনার আগের একটি খসড়া এখনো অপেক্ষায় আছে" if (waiting.meta or {}).get("via") == "f0"
                            else "এই ব্যক্তির জন্য সহকারীর আরেকটি খসড়া অপেক্ষায় আছে")
        draft = WaMessage(contact_id=target.id, direction="out", channel=target.channel or "whatsapp", kind="text", body=body, status="draft", reason="owner",
                          meta={"via": "f0", "note": "আপনার নির্দেশে খসড়া — আপনি অনুমোদন না করলে যাবে না"})
        db.add(draft)
        await db.flush()
    await db.commit()
    return _reply("reply", f"{target.name or 'এই ব্যক্তি'}-কে পাঠানোর খসড়া তৈরি। পাঠাতে অনুমোদন করুন; এখনো কিছু পাঠানো হয়নি।", draft={
        "id": str(draft.id), "to": _label(target), "channel": target.channel or "whatsapp", "body": msg, "warnings": warnings})


async def run(db: AsyncSession, text: str, now: datetime | None = None) -> dict[str, Any]:
    now = now or flow.utcnow()
    p = parse(text)
    intent = p["intent"]
    if intent == "unknown":
        return _reply("unknown", UNKNOWN_HELP)
    if intent == "missed_calls":
        rows = (await db.execute(select(WaMessage, WaContact).join(WaContact, WaContact.id == WaMessage.contact_id)
                                 .where(WaMessage.direction == "in", WaMessage.created_at >= now - timedelta(hours=24)).order_by(WaMessage.created_at.desc()).limit(200))).all()
        per: dict[Any, list[Any]] = {}
        for m, c in rows:
            if is_call({"meta": m.meta, "body": m.body}):
                per.setdefault(c.id, [c, 0, m.created_at])
                per[c.id][1] += 1
        items = [{"title": _label(c), "subtitle": f"{n}টি মিসড কল, শেষটি {last.astimezone(UTC):%H:%M} UTC", "contact_id": str(c.id)} for c, n, last in per.values()]
        return _reply(intent, f"গত ২৪ ঘণ্টায় {len(items)} জনের মিসড কল" if items else "গত ২৪ ঘণ্টায় কোনো মিসড কল নেই", items)
    if intent == "pending":
        cs = (await db.execute(select(WaContact).where(WaContact.last_inbound_at >= now - timedelta(hours=48), WaContact.is_blocked == False,  # noqa: E712
                                                        WaContact.state != "owner").order_by(WaContact.last_inbound_at.desc()).limit(40))).scalars().all()
        items = []
        for c in cs:
            st = ts.assess(await flow.recent_messages(db, c.id, 20))
            if st.status in ts.NEEDS_ANSWER and st.unanswered:
                items.append({"title": _label(c), "subtitle": f"{st.unanswered}টি বার্তা — {st.label}", "contact_id": str(c.id)})
        return _reply(intent, f"{len(items)} জনের উত্তর বাকি (কেউ উত্তর দিয়েছে এমন প্রমাণ নেই)" if items else "উত্তর বাকি আছে এমন কেউ পাইনি", items[:10])
    if intent == "tasks":
        open_tasks = (await db.execute(select(WaTask).where(WaTask.is_done == False).order_by(WaTask.due_at.asc().nullslast()).limit(10))).scalars().all()  # noqa: E712
        items = [{"title": t.title, "subtitle": ("প্রস্তাবিত, নিশ্চিত করা হয়নি" if t.source == "proposed" else "খোলা") + (f", সময় {t.due_at:%d/%m}" if t.due_at else ""),
                  "contact_id": str(t.contact_id) if t.contact_id else ""} for t in open_tasks]
        return _reply(intent, f"{len(items)}টি খোলা কাজ" if items else "কোনো খোলা কাজ নেই", items)

    contacts, choices = await resolve(db, p["name"], p["contact_id"])
    if choices:
        return _reply(intent, f"“{p['name']}” নামে একাধিক জন আছে: কোন জন?", choices=choices)
    if not contacts:
        return _reply(intent, f"“{p['name']}” নামে কাউকে পাইনি" if p["name"] else "কার কথা বলছেন বুঝতে পারিনি")
    who = contacts[0].name or p["name"]
    if intent == "reply":
        return await _reply_draft(db, contacts, p["msg"], now)
    if intent == "task_status":
        theirs = (await db.execute(select(WaTask).where(WaTask.contact_id.in_([c.id for c in contacts])).order_by(WaTask.created_at.desc()).limit(5))).scalars().all()
        known = [{"title": t.title, "due_at": t.due_at, "is_done": t.is_done, "done_at": t.done_at, "source": t.source} for t in theirs]
        return _reply(intent, assignments.status_note(known, now, privacy.is_private(contacts[0])), [{"title": t.title, "subtitle": s[1]} for t, s in zip(theirs, assignments.task_status(known, now))])
    if intent == "memory":
        facts = memory.view(contacts[0].profile, privacy.unseal)
        items = [{"title": f["text"], "subtitle": ("অনুমান" if f["inferred"] else "আপনার দেওয়া") + f", আস্থা {f['confidence']}"} for f in facts if f["status"] == "active"][:10]
        return _reply(intent, f"{who} সম্পর্কে {len(items)}টি তথ্য মনে আছে" if items else f"{who} সম্পর্কে কোনো তথ্য সংরক্ষিত নেই", items)
    st = ts.assess(await flow.recent_messages(db, [c.id for c in contacts], 30))
    return _reply("person", f"{who}: {len(contacts)}টি পরিচয় ({', '.join(sorted({c.channel or 'whatsapp' for c in contacts}))}); {st.label}",
                  [{"title": _label(c), "contact_id": str(c.id)} for c in contacts])
