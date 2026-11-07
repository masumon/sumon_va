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

from app.assistant import assignments, identity, memory, presence, privacy
from app.assistant import wa_brain as brain
from app.assistant import wa_config as wcfg
from app.assistant.channels import alerts as alerts_mod
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
_SEARCH_NAME = re.compile(r"^\s*(?P<name>\S+(?:\s\S+)?)\s*(?:কী|কি)\s*(?:বলেছে|বলেছিল|চেয়েছে|চেয়েছিল|লিখেছে|লিখেছিল)|what\s+did\s+(?P<name2>\w+)\s+(?:say|ask|want)", re.I)
_SEARCH_Q = re.compile(r"(?:খুঁজো|খুঁজুন|খোঁজো|সার্চ)\s+(?P<q>.+)|^\s*(?:search|find)\s+(?P<q2>.+)", re.I | re.S)
_ALERTS = re.compile(r"অ্যালার্ট|জরুরি|urgent|alerts?", re.I)
_DRAFTS = re.compile(r"খসড়া|drafts?", re.I)
_HISTORY = re.compile(r"কী\s*কী\s*পাঠানো|কী\s*পাঠানো|সাম্প্রতিক\s*কাজ|পাঠানোর\s*ইতিহাস|recent\s+(?:actions|sent)|action\s+history", re.I)
_SYSTEM = re.compile(r"সহকারী(?:র)?\s*(?:অবস্থা|স্ট্যাটাস)|সব\s*ঠিক\s*আছে|\bhealth\b|\bstatus\b", re.I)
_RULES = re.compile(r"নিয়ম|সেটিং|\brules?\b|\bsettings?\b", re.I)
UNKNOWN_HELP = "বুঝতে পারিনি। যেমন লিখতে পারেন: “রহিমকে বলো কাল জানাব”, “রহিমের কাজের কী হলো”, “মিসড কল”, “কার উত্তর বাকি”, “আমার কাজ”, “রহিম সম্পর্কে কী জানো”, “রহিম কী বলেছে”, “খুঁজো দাম”, “জরুরি”, “খসড়া”, “কী কী পাঠানো হয়েছে”, “সহকারীর অবস্থা”, “নিয়ম”"


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
    sn = _SEARCH_NAME.match(t)
    if sn:
        return {"intent": "search", "name": (sn.group("name") or sn.group("name2")).strip(), "msg": "", "contact_id": cid}
    sq = _SEARCH_Q.search(t)
    if sq:
        return {"intent": "search", "name": "", "msg": (sq.group("q") or sq.group("q2")).strip(), "contact_id": cid}
    if _CALLS.search(t):
        return {"intent": "missed_calls", "name": "", "msg": "", "contact_id": cid}
    if _PENDING.search(t):
        return {"intent": "pending", "name": "", "msg": "", "contact_id": cid}
    if _TASKS.search(t):
        return {"intent": "tasks", "name": "", "msg": "", "contact_id": cid}
    for rx, intent in ((_HISTORY, "history"), (_DRAFTS, "drafts"), (_ALERTS, "alerts"), (_SYSTEM, "system"), (_RULES, "rules")):
        if rx.search(t):
            return {"intent": intent, "name": "", "msg": "", "contact_id": cid}
    mm = _PERSON.match(t)
    if mm:
        return {"intent": "person", "name": (mm.group("name") or mm.group("name2")).strip(), "msg": "", "contact_id": cid}
    return {"intent": "unknown", "name": "", "msg": "", "contact_id": cid}


AI_INTENTS = ("reply", "search", "task_status", "memory", "person", "missed_calls", "pending", "tasks", "alerts", "drafts", "history", "system", "rules")
_AI_SYSTEM = (
    "You turn the owner's short command (Bangla, Banglish or English) into JSON for his personal assistant app. Reply with JSON only: "
    '{"intent": one of ' + ", ".join(AI_INTENTS) + ', "name": the person he means or "", "msg": the exact words to send (for reply) or the search words, or ""}. '
    "reply = he wants a message sent to someone; search = find what someone said or find words; task_status = how a person's work/payment/order stands; "
    "memory = what is known about a person; person = who someone is; missed_calls; pending = who is waiting for an answer; tasks = his own task list; "
    "alerts = urgent things; drafts = messages waiting for approval; history = what was sent; system = is the assistant working; rules = settings. "
    "Keep the message in the owner's own language and words; never invent facts, prices or dates. Unknown: {\"intent\": \"unknown\"}."
)


async def ai_parse(db: AsyncSession, text: str) -> dict[str, Any] | None:
    """When the fixed patterns do not fit, the owner's own command (never a contact's message) is read by the connected AI.
    Only an allowed intent is accepted; the server then does the real work with the owner's own data. None = AI unavailable/unsure."""
    import json as _json

    from app.assistant import ai_hub

    try:
        out = await ai_hub.run(db, "json", _AI_SYSTEM, (text or "")[:400], json_mode=True, max_tokens=200)
        data = _json.loads(out[out.find("{"):out.rfind("}") + 1])
    except Exception:  # noqa: BLE001 - no AI, quota, bad JSON: fall back to the fixed help text
        return None
    intent = str(data.get("intent") or "")
    if intent not in AI_INTENTS:
        return None
    name, msg = str(data.get("name") or "").strip()[:60], str(data.get("msg") or "").strip()[:1000]
    if intent in ("reply", "task_status", "memory", "person") and not name:
        return None
    if intent == "reply" and len(msg) < 2:
        return None
    return {"intent": intent, "name": name, "msg": msg, "contact_id": None, "via_ai": True}


async def auto_send_on(db: AsyncSession) -> bool:
    """The owner's F0 switch: True = a clear "tell X ..." command is sent at once (no preview). Default off (manual)."""
    cfg = await wcfg.load_config(db, scope="app")
    return bool((cfg.get("f0") or {}).get("auto_send"))


async def _auto_send(db: AsyncSession, res: dict[str, Any]) -> dict[str, Any]:
    """Send the draft just made, but only when nothing needs a second look (any warning keeps the preview)."""
    d = res.get("draft")
    if not d or d.get("warnings"):
        if d and d.get("warnings"):
            res["answer"] = res["answer"] + " · অটো-পাঠানো হয়নি: আগে একবার দেখে নিন"
        return res
    m = await db.get(WaMessage, uuid.UUID(d["id"]))
    if not m or m.status != "draft":
        return res
    m.status, m.send_after, m.error = "queued", flow.utcnow(), None
    await db.commit()
    ok = await flow.deliver(db, m.id)
    await db.refresh(m)
    label = {"sent": "পাঠানো হয়েছে", "sending": "ফোনকে পাঠাতে দেওয়া হয়েছে", "queued": "পাঠানোর লাইনে আছে"}.get(m.status or "", m.status or "")
    answer = f"{d['to']}-কে {label}" if ok or m.status in ("sent", "sending", "queued") else f"{d['to']}-কে পাঠানো যায়নি: {m.error or 'কারণ জানা নেই'}"
    return {**res, "answer": brain.bn_digits(answer), "draft": None, "sent": {"status": m.status, "error": m.error}}


def _reply(intent: str, answer: str, items=None, choices=None, draft=None) -> dict[str, Any]:
    answer = brain.bn_digits(answer)  # the owner reads Bangla: ৭ জন, not 7 জন
    return {"intent": intent, "answer": answer, "items": items or [], "choices": choices or [], "draft": draft}


CHANNEL_BN = {"whatsapp": "WhatsApp", "telegram": "Telegram", "sms": "SMS", "device": "SMS", "notif": "ফোনের চ্যাট-অ্যাপ", "email": "ইমেইল", "webhook": "ওয়েবসাইট"}


def _label(c: WaContact) -> str:
    """Plain words for the owner: the person's name and where the chat is, never a code."""
    return f"{c.name or c.phone.split(':')[-1]} ({CHANNEL_BN.get(c.channel or 'whatsapp', 'অন্য মাধ্যম')})"


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
    if p["intent"] == "unknown":  # free words: let the connected AI read the owner's own command
        clean = _ID.sub("", text or "").strip()
        ai = await ai_parse(db, clean) if len(clean) >= 3 else None
        if ai:
            ai["contact_id"] = p["contact_id"]
            p = ai
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

    if intent in ("alerts", "drafts", "history", "system", "rules") or (intent == "search" and p["msg"] and not p["name"]):
        return await _overview_intents(db, intent, p, now)

    contacts, choices = await resolve(db, p["name"], p["contact_id"])
    if choices:
        return _reply(intent, f"“{p['name']}” নামে একাধিক জন আছে: কোন জন?", choices=choices)
    if not contacts:
        return _reply(intent, f"“{p['name']}” নামে কাউকে পাইনি" if p["name"] else "কার কথা বলছেন বুঝতে পারিনি")
    who = contacts[0].name or p["name"]
    if intent == "reply":
        res = await _reply_draft(db, contacts, p["msg"], now)
        return await _auto_send(db, res) if await auto_send_on(db) else res
    if intent == "search":
        return await _search_person(db, contacts, who)
    if intent == "task_status":
        theirs = (await db.execute(select(WaTask).where(WaTask.contact_id.in_([c.id for c in contacts])).order_by(WaTask.created_at.desc()).limit(5))).scalars().all()
        known = [{"title": t.title, "due_at": t.due_at, "is_done": t.is_done, "done_at": t.done_at, "source": t.source} for t in theirs]
        return _reply(intent, assignments.status_note(known, now, privacy.is_private(contacts[0])), [{"title": t.title, "subtitle": s[1]} for t, s in zip(theirs, assignments.task_status(known, now))])
    if intent == "memory":
        facts = memory.view(contacts[0].profile, privacy.unseal)
        items = [{"title": f["text"], "subtitle": ("অনুমান" if f["inferred"] else "আপনার দেওয়া") + f", আস্থা {f['confidence']}"} for f in facts if f["status"] == "active"][:10]
        return _reply(intent, f"{who} সম্পর্কে {len(items)}টি তথ্য মনে আছে" if items else f"{who} সম্পর্কে কোনো তথ্য সংরক্ষিত নেই", items)
    st = ts.assess(await flow.recent_messages(db, [c.id for c in contacts], 30))
    return _reply("person", f"{who}: {len(contacts)}টি পরিচয় ({', '.join(sorted({CHANNEL_BN.get(c.channel or 'whatsapp', 'অন্য মাধ্যম') for c in contacts}))}); {st.label}",
                  [{"title": _label(c), "contact_id": str(c.id)} for c in contacts])


# -- more of what the owner may ask (Brain_Prompt section 12): search, alerts, drafts, history, health, rules ---------------------

def _clip(text: str | None, n: int = 90) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def _when(dt: datetime | None) -> str:
    if not dt:
        return ""
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(brain.now_dhaka().tzinfo or UTC).strftime("%d/%m %H:%M")


async def _search_person(db: AsyncSession, contacts: list[WaContact], who: str) -> dict[str, Any]:
    """What this person wrote lately. Private and family chats are NOT searched (their words stay sealed and out of the way)."""
    open_ = [c for c in contacts if not privacy.is_private(c)]
    if not open_:
        return _reply("search", f"{who} ব্যক্তিগত/পরিবারের চ্যাট, তাই সার্চে ধরা হয় না — অ্যাপে চ্যাট খুলে পড়ুন")
    rows = (await db.execute(select(WaMessage).where(WaMessage.contact_id.in_([c.id for c in open_]), WaMessage.direction == "in", WaMessage.status != "imported")
                             .order_by(WaMessage.created_at.desc()).limit(8))).scalars().all()
    items = [{"title": _clip(privacy.unseal(m.transcript or m.body)), "subtitle": f"{_when(m.created_at)} · {CHANNEL_BN.get(m.channel or '', '')}", "contact_id": str(m.contact_id)} for m in rows]
    return _reply("search", f"{who}-এর শেষ {len(items)}টি বার্তা" if items else f"{who}-এর কোনো বার্তা পাইনি", items)


async def _overview_intents(db: AsyncSession, intent: str, p: dict[str, Any], now: datetime) -> dict[str, Any]:
    if intent == "search":  # a word or phrase, across the chats that are not private
        q = p["msg"][:60]
        rows = (await db.execute(select(WaMessage, WaContact).join(WaContact, WaContact.id == WaMessage.contact_id)
                                 .where(WaMessage.body.ilike(f"%{q}%"), WaMessage.status != "imported").order_by(WaMessage.created_at.desc()).limit(40))).all()
        hits = [(m, c) for m, c in rows if not privacy.is_private(c)][:8]
        items = [{"title": _clip(m.body), "subtitle": f"{_label(c)} · {_when(m.created_at)}", "contact_id": str(c.id)} for m, c in hits]
        return _reply("search", f"“{q}” আছে এমন {len(items)}টি বার্তা (ব্যক্তিগত/পরিবারের চ্যাট ধরা হয় না)" if items else f"“{q}” লেখা কোনো বার্তা পাইনি", items)
    if intent == "alerts":
        held = await alerts_mod.held_alerts(db)
        urgent = (await db.execute(select(WaContact).where(WaContact.unread > 0, WaContact.state != "done", WaContact.priority.in_((1, 2, 4)), WaContact.is_blocked == False)  # noqa: E712
                                   .order_by(WaContact.last_inbound_at.desc().nullslast()).limit(8))).scalars().all()
        items = [{"title": _label(c), "subtitle": f"জরুরি, {c.unread}টি অপঠিত", "contact_id": str(c.id)} for c in urgent]
        items += [{"title": h.get("who", ""), "subtitle": f"আটকে ছিল: {h.get('why', '')}"} for h in held[-5:]]
        return _reply("alerts", f"{len(urgent)} জন জরুরি অপেক্ষায়, {len(held)}টি অ্যালার্ট আটকে ছিল" if items else "এখন কোনো জরুরি বিষয় নেই", items)
    if intent == "drafts":
        rows = (await db.execute(select(WaMessage, WaContact).join(WaContact, WaContact.id == WaMessage.contact_id)
                                 .where(WaMessage.direction == "out", WaMessage.status == "draft").order_by(WaMessage.created_at.desc()).limit(10))).all()
        items = [{"title": _label(c), "subtitle": _clip(privacy.unseal(m.body), 80), "contact_id": str(c.id)} for m, c in rows]
        return _reply("drafts", f"{len(items)}টি খসড়া আপনার অনুমোদনের অপেক্ষায়" if items else "অনুমোদনের অপেক্ষায় কোনো খসড়া নেই", items)
    if intent == "history":
        rows = (await db.execute(select(WaMessage, WaContact).join(WaContact, WaContact.id == WaMessage.contact_id)
                                 .where(WaMessage.direction == "out").order_by(WaMessage.created_at.desc()).limit(10))).all()
        names = {"sent": "পাঠানো হয়েছে", "draft": "খসড়া", "failed": "যায়নি", "sending": "ফোনকে দেওয়া হয়েছে, নিশ্চিত নয়", "queued": "অপেক্ষায়", "cancelled": "বাতিল"}
        by = {"owner": "আপনার নির্দেশে", "manual": "আপনি নিজে", "assistant": "সহকারী"}
        items = [{"title": _label(c), "subtitle": f"{names.get(m.status, m.status)} · {by.get(m.reason or '', 'সহকারী')} · {_when(m.created_at)}" + (f" · {m.error}" if m.status == "failed" and m.error else ""),
                  "contact_id": str(c.id)} for m, c in rows]
        return _reply("history", f"শেষ {len(items)}টি বার্তার অবস্থা" if items else "এখনো কোনো বার্তা পাঠানো হয়নি", items)
    cfg = await wcfg.load_config(db, scope="app")
    if intent == "rules":
        lim, rem = cfg.get("limits") or {}, cfg.get("reminders") or {}
        items = [
            {"title": "সহকারী", "subtitle": ("চালু" if cfg.get("enabled") else "বন্ধ") + " · উত্তরের ধরন: " + ("নিজে নিজে" if cfg.get("mode") == "auto" else "খসড়া")},
            {"title": "জরুরি অ্যালার্ট", "subtitle": f"দিনে সর্বোচ্চ {lim.get('urgent_per_day', 5)}টি; নীরব সময় {lim.get('quiet_from', '23:00')}–{lim.get('quiet_to', '07:00')}"},
            {"title": "উত্তর বাকি রিমাইন্ডার", "subtitle": (f"{rem.get('unanswered_min')} মিনিট পর" if rem.get("unanswered_min") else "বন্ধ")},
            {"title": "বার্তা জমানো", "subtitle": f"{(cfg.get('grouping') or {}).get('window_min', 5)} মিনিট"},
        ]
        return _reply("rules", "বর্তমান নিয়ম (বদলাতে নিয়ম স্ক্রিনে যান)", items)
    waiting = (await db.execute(select(WaContact.id).where(WaContact.unread > 0, WaContact.state != "done"))).all()
    st = brain.current_status(cfg)
    bits = [f"সহকারী {'চালু' if cfg.get('enabled') else 'বন্ধ'}", f"এখনকার অবস্থা: {(st.get('label') or st.get('key') or '') if isinstance(st, dict) else st}", f"{len(waiting)} জন অপেক্ষায়"]
    return _reply("system", " · ".join(str(b) for b in bits))
