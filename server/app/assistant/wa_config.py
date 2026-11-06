"""Settings of Sumon's personal WhatsApp assistant.

Everything the owner may want to change lives in two rows of the ordinary `settings` table and is edited from
Admin → WhatsApp সহকারী — nothing is baked into the logic. DEFAULT_CONFIG is only the starting text/values:
anything saved in the panel wins, and "reset" puts a section back to these defaults.
  wa_config       plain JSON (switches, scripts, rules, schedule …)
  wa_secrets_enc  Meta credentials, Fernet-encrypted (never sent back to the browser)
"""
from __future__ import annotations

import copy
from contextvars import ContextVar
import json
import re
import secrets as _secrets
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.totp_crypto import decrypt_totp_secret as _dec, encrypt_totp_secret as _enc  # generic Fernet helper
from app.models.models import Setting

CONFIG_KEY = "wa_config"
SECRETS_KEY = "wa_secrets_enc"
SECRET_FIELDS = ("token", "phone_number_id", "waba_id", "app_secret", "verify_token", "graph_version")
PLAIN_FIELDS = ("phone_number_id", "waba_id", "graph_version")  # safe to show in full

STATUSES = [
    {"key": "free", "label": "ফ্রি আছি", "say": ""},
    {"key": "sleeping", "label": "ঘুমাচ্ছি / বিশ্রামে", "say": "{owner} এখন বিশ্রামে আছেন।"},
    {"key": "meeting", "label": "মিটিংয়ে", "say": "{owner} এখন মিটিংয়ে আছেন।"},
    {"key": "prayer", "label": "নামাজে", "say": "{owner} এখন নামাজে আছেন।"},
    {"key": "driving", "label": "গাড়িতে / পথে", "say": "{owner} এখন পথে আছেন।"},
    {"key": "busy", "label": "ব্যস্ত", "say": "{owner} এখন একটু ব্যস্ত আছেন।"},
    {"key": "holiday", "label": "ছুটিতে", "say": "{owner} এখন ছুটিতে আছেন।"},
]

QUESTIONS = [
    {"kind": "work", "label": "নতুন কাজের অনুসন্ধান",
     "words": ["কাজ", "লাগবে", "ডিজাইন", "প্রিন্ট", "ওয়েবসাইট", "সফটওয়্যার", "মেরামত", "কোটেশন", "দাম কত", "design", "print", "website", "software", "repair", "quote", "need"],
     "ask": ["কাজটি কী ধরনের, একটু লিখে বলবেন?", "কবে নাগাদ দরকার?"]},
    {"kind": "update", "label": "কাজের অবস্থা জানতে চান",
     "words": ["কতদূর", "কবে পাব", "কবে পাবো", "হলো কি", "তৈরি হয়েছে", "আপডেট", "ready", "status", "update", "done yet"],
     "ask": ["আপনার নাম ও কাজটি কী, একটু লিখে দেবেন?"]},
    {"kind": "meet", "label": "দেখা / কথা বলতে চান",
     "words": ["দেখা করতে", "মিটিং", "কথা বলতে", "সাক্ষাৎ", "meet", "meeting", "talk to"],
     "ask": ["কী বিষয়ে কথা বলতে চান?", "কোন সময় আপনার সুবিধা?"]},
    {"kind": "money", "label": "টাকা-পয়সা সংক্রান্ত",
     "words": ["টাকা", "পেমেন্ট", "বিকাশ", "নগদ", "বাকি", "ডলার", "payment", "bkash", "dollar", "paypal", "invoice"],
     "ask": ["কোন বিষয়ে ও কত টাকার ব্যাপারে, সংক্ষেপে লিখবেন?"]},
    {"kind": "other", "label": "অন্যান্য",
     "words": [], "ask": ["কী প্রয়োজনে লিখেছেন, দয়া করে একটু বিস্তারিত লিখবেন?"]},
]

# English wording for people who write in English (used when the saved question has no ask_en of its own)
DEFAULT_ASK_EN = {
    "work": ["What kind of work is it? Please tell us briefly.", "When do you need it?"],
    "update": ["Please tell us your name and which work this is about."],
    "meet": ["What would you like to talk about?", "What time suits you?"],
    "money": ["Please briefly tell us what it is about and the amount."],
    "other": ["What is this regarding? Please write a little more detail."],
}
DEFAULT_SAY_EN = {
    "sleeping": "{owner} is resting right now.", "meeting": "{owner} is in a meeting right now.", "prayer": "{owner} is at prayer right now.",
    "driving": "{owner} is on the road right now.", "busy": "{owner} is a bit busy right now.", "holiday": "{owner} is on leave right now.",
}

_BN = {
    "salam_reply": "ওয়া আলাইকুমুস সালাম।",
    "greeting": "আসসালামু আলাইকুম। আমি {assistant}।",
    "away_notice": "দয়া করে কল বা ভয়েস মেসেজ না দিয়ে আপনার সমস্যা বা প্রয়োজনটি লিখে জানান।",
    "ask_intro": "বিষয়টি ঠিকভাবে জানাতে একটু সাহায্য করুন:",
    "thanks": "ধন্যবাদ {name}। আপনার কথাগুলো লিখে রাখলাম, {reply_by} {owner} উত্তর দেবেন, ইনশাআল্লাহ।",
    "urgent_ack": "আপনার বার্তা পেয়েছি। বিষয়টি জরুরি মনে হচ্ছে, {owner}কে এখনই জানানো হয়েছে।",
    "repeat_ack": "আপনার বার্তা আগেই পেয়েছি এবং {owner}কে জানানো হয়েছে। অপেক্ষার জন্য দুঃখিত, {reply_by} উত্তর পাবেন।",
    "call_notice": "{owner} এখন কল ধরতে পারছেন না। দয়া করে কল না দিয়ে প্রয়োজনটি লিখে জানান, {reply_by} উত্তর দেবেন।",
    "voice_ack": "ভয়েস মেসেজ পেয়েছি, {owner}কে জানিয়ে দিলাম। সম্ভব হলে সংক্ষেপে লিখেও জানাতে পারেন।",
    "unknown_ack": "এ বিষয়ে আমি নিশ্চিত নই। {owner}কে জিজ্ঞেস করে {reply_by} জানানো হবে।",
    "identity_reply": "জি, আমি {assistant}, মানুষ নই। আপনার কথা {owner}কে জানিয়ে দিচ্ছি, {reply_by} উনি নিজে উত্তর দেবেন।",
    "note_reply": "{note}",
}
_EN = {
    "salam_reply": "Wa alaikum assalam.",
    "greeting": "Assalamu alaikum. I am {assistant}.",
    "away_notice": "Please don't call or send voice notes; kindly write your issue or request here.",
    "ask_intro": "To help {owner} understand, please tell us:",
    "thanks": "Thank you {name}. I have noted everything; {owner} will reply {reply_by}, InshaAllah.",
    "urgent_ack": "I received your message. It looks urgent, so {owner} has been informed right now.",
    "repeat_ack": "I already received your message and {owner} has been informed. Sorry for the wait; you will hear back {reply_by}.",
    "call_notice": "{owner} cannot take calls right now. Please write what you need instead; he will reply {reply_by}.",
    "voice_ack": "I received your voice message and let {owner} know. If possible, please also write it briefly.",
    "unknown_ack": "I am not sure about this. I will ask {owner} and let you know {reply_by}.",
    "identity_reply": "I am {assistant}, not a person. I am passing your message to {owner}; he will reply himself {reply_by}.",
    "note_reply": "{note}",
}

from app.assistant.channels import platforms  # noqa: E402  (defaults for the per-platform settings)

DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,              # master switch — nothing happens while off
    "mode": "shadow",              # shadow = only prepare drafts | auto = send the allowed replies
    "assistant_name": "সুমন ভাইয়ের ভার্চুয়াল সহকারী",
    "owner_name": "সুমন ভাই",
    "status": {"key": "free", "until": None, "custom": ""},
    "statuses": STATUSES,
    "places": [],                  # [{"key","label","say","lat","lng","radius_m"}] saved places; see timectx.normalize_places
    "schedule": [],                # [{"days":[0..6 Mon=0], "from":"13:00", "to":"16:00", "status":"sleeping"}]
    "assistant_name_en": "Sumon's virtual assistant",   # used when the person writes in English
    "owner_name_en": "Sumon",
    "reply_by_en": "as soon as he can",
    "reply_by": "পরে সুযোগ পেলেই",  # said as {reply_by}; the owner usually sets e.g. "বিকেল ৪টার পর"
    "delay": {"min": 20, "max": 60},       # seconds to wait before an automatic reply
    "hold_hours": 12,              # after the owner replies himself, the assistant stays quiet this long
    "quiet_after_reply_min": 20,   # don't answer again within this time unless it is urgent or a new question
    "per_sender_hour": 10,         # at most this many automatic replies to one person per hour
    "scripts": {"bn": _BN, "en": _EN},
    "questions": QUESTIONS,
    "max_questions": 2,
    "priority_rules": {
        "p1": ["আম্মা", "আব্বা", "হাসপাতাল", "অসুস্থ", "দুর্ঘটনা", "মারা গেছেন", "জরুরি", "ইমার্জেন্সি", "emergency", "urgent", "accident", "hospital"],
        "p2": ["ডলার", "পেমেন্ট", "বিকাশ", "paypal", "payment", "dollar", "usd", "invoice"],
        "p4": ["কই", "সিন করেন না", "রিপ্লাই দেন না", "কল ধরেন না", "ধরছেন না", "why no reply", "not replying"],
    },
    "never_auto_words": ["মামলা", "থানা", "পুলিশ", "ফতোয়া", "তালাক", "আইনজীবী", "lawyer", "police", "court"],
    "call_words": ["কল দিলাম", "ফোন দিলাম", "ফোন ধরলেন না", "কল ধরলেন না", "ফোন করেছিলাম", "called you", "missed your call", "tried calling"],
    "identity_words": ["বট", "রোবট", "মেশিন", "এআই", "আপনি কি মানুষ", "সত্যিই সুমন", "are you a bot", "are you human", "real person", "chatbot"],
    "abo": {"enabled": False, "info": True, "orders": False, "leads": False, "prices": False, "facts": ""},
    "ai": {"enabled": True, "voice": True},
    "notify": {"urgent": True, "digest": True, "digest_time": "08:00"},
    "retention_days": 90,
    # Tags that mean "this person matters": their words raise the priority; client-like tags make the chat business.
    "tag_client_words": ["ক্লায়েন্ট", "গ্রাহক", "client", "customer", "কাস্টমার"],
    # E-mail: bring only what matters. mode "important" drops promotions/newsletters/no-reply mail before it is stored; "all" keeps everything.
    "email_filter": {"mode": "important", "allow": [], "block": []},
    "auto_presence": True,   # let the phone's screen/motion/location set the status ("sleeping", "on the road") while the owner has none set
    # Business / personal / social / spam: what the assistant may do for each (owner-editable). Family is always personal.
    "categories": {"business": {"auto": True}, "personal": {"auto": False}, "social": {"auto": False}, "spam": {"silent": True}},
    # How long messages are kept (days). Personal chats go first; family has its own; business keeps the general period.
    "retention_by_category": {"personal": 7, "social": 30, "spam": 3, "business": 90},
    "retention_family_days": 30,
    "category_words": {
        "spam": ["লটারি", "জিতেছেন", "ফ্রি রিচার্জ", "অফার শেষ হচ্ছে", "ক্লিক করুন", "লোন পেতে", "ক্যাশব্যাক", "বিজ্ঞাপন", "unsubscribe", "lottery", "click here", "free gift", "winner", "loan approved", "promo code"],
        "social": ["দাওয়াত", "নিমন্ত্রণ", "আমন্ত্রণ", "বিয়ে", "বিবাহ", "জন্মদিন", "শুভেচ্ছা", "ঈদ মোবারক", "ঈদ মুবারক", "শুভ নববর্ষ", "অভিনন্দন", "দোয়া", "ইন্তেকাল", "জানাজা", "মিলাদ", "অনুষ্ঠান", "ওয়ালিমা", "happy birthday", "eid mubarak", "invitation", "congratulations", "condolence", "wedding"],
        "personal": ["কেমন আছ", "কেমন আছেন", "খেয়েছ", "কোথায় তুমি", "আম্মু", "আব্বু", "আপু", "বন্ধু", "দোস্ত", "মামা", "চাচা", "খালা", "how are you", "where are you", "miss you"],
    },
    # Unified inbox: how loud the assistant may be, and which channels are switched on.
    # Missed calls: one alert per burst (minutes); escalate_after 0 = a later call in the same burst alerts again only with new evidence;
    # reply False = the assistant never writes to a caller by itself (the owner hears about the call).
    "calls": {"burst_min": 10, "escalate_after": 0, "reply": False},
    # Several messages from one person within `window_min` minutes are answered once (0 = off). Urgent ones never wait.
    "grouping": {"window_min": 5},
    # "No answer found" reminder after N minutes (0 = off): never claims the message was read.
    "reminders": {"unanswered_min": 0, "only_important": True, "task_lead_min": 0},  # task_lead_min: remind N minutes before a confirmed task is due (0 = off)
    "limits": {"urgent_per_day": 5, "quiet_from": "23:00", "quiet_to": "07:00", "quiet_urgent_only": True},
    "channels": {"telegram": {"enabled": False, "auto": False}, "device": {"enabled": True, "auto_sms": False}, "email": {"enabled": False}},
    "platforms": platforms.default_block(),
    "custom_platforms": [],        # apps the owner added himself: [{"key","name","packages":[...]}], see platforms.normalize_custom
    # Which number the panel is connected to. "main" (the owner's real number) can only be switched on after every box is ticked.
    "readiness": {"target": "test", "backup": False, "app_updated": False, "spare_tested": False, "limits_read": False, "disconnect_known": False},
}

READINESS_LABELS = {
    "backup": "ফোনের WhatsApp Business-এ চ্যাট ব্যাকআপ নিয়েছি",
    "app_updated": "WhatsApp Business অ্যাপ নতুন সংস্করণে (২.২৪.১৭ বা তার বেশি) আপডেট করেছি",
    "spare_tested": "একটা অতিরিক্ত নম্বরে আগে পুরো সংযোগ পরীক্ষা করে দেখেছি",
    "limits_read": "সীমাবদ্ধতা পড়েছি (গ্রুপ চ্যাট সিঙ্ক হয় না, ব্রডকাস্ট শুধু পড়া যায়, অন্য ডিভাইস আনলিংক হয়)",
    "disconnect_known": "জানি কীভাবে ফেরা যায় (Settings → Account → Business platform → Disconnect)",
}


def readiness_problem(cfg: dict[str, Any]) -> str | None:
    """Switching the assistant on for the owner's real number needs every safety box ticked. None = fine."""
    r = cfg.get("readiness") or {}
    if not cfg.get("enabled") or r.get("target") != "main":
        return None
    missing = [label for key, label in READINESS_LABELS.items() if not r.get(key)]
    if missing:
        return "মূল নম্বরে চালুর আগে “সংযোগ” ট্যাবের নিরাপত্তা-তালিকার সব ঘরে টিক দিন। বাকি: " + "; ".join(missing)
    return None

_cache: dict[str, tuple[float, dict[str, Any]]] = {}  # per scope

# Two owners of settings, kept apart on purpose: the admin WEBSITE runs the official WhatsApp (Cloud API) number, the phone APP
# (সুমনের ভার্চুয়াল সহকারী) runs everything the phone and the bot bring in. A change on one side never changes the other.
# The scope follows the request (phone token -> "app") or the conversation's channel (Cloud-API WhatsApp -> "web").
SCOPES = {"web": CONFIG_KEY, "app": "va_app_config"}
_scope: ContextVar[str] = ContextVar("wa_cfg_scope", default="web")


def use_scope(scope: str) -> None:
    _scope.set(scope if scope in SCOPES else "web")


def current_scope() -> str:
    return _scope.get()


def scope_for_channel(channel: str | None) -> str:
    return "web" if (channel or "whatsapp") == "whatsapp" else "app"
_TTL = 20.0


# ── tiny helpers ──────────────────────────────────────────────────────────────

def deep_merge(base: dict, patch: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in patch.items():
        out[k] = deep_merge(out[k], v) if isinstance(out.get(k), dict) and isinstance(v, dict) else copy.deepcopy(v)
    return out


def _free(v: Any, depth: int = 0) -> Any:
    """Keep plain JSON only, capped in size, so a pasted blob can never bloat the settings row."""
    if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        return v.strip()[:700]
    if isinstance(v, list) and depth < 3:
        return [_free(i, depth + 1) for i in v[:120]]
    if isinstance(v, dict) and depth < 3:
        return {str(k)[:40]: _free(i, depth + 1) for k, i in list(v.items())[:60]}
    return None


def sanitize(new: Any, default: Any) -> Any:
    """Shape `new` like `default`: unknown keys dropped, wrong types fall back to nothing (caller keeps old)."""
    if isinstance(default, dict):
        if not isinstance(new, dict):
            return {}
        return {k: sanitize(new[k], d) for k, d in default.items() if k in new}
    if isinstance(default, bool):
        return bool(new)
    if isinstance(default, int):
        try:
            return max(0, min(int(new), 100000))
        except (TypeError, ValueError):
            return default
    if isinstance(default, str):
        return _free(str(new if new is not None else ""))
    if isinstance(default, list):
        return _free(new) if isinstance(new, list) else default
    return _free(new)


def fill(template: str, **vars_: str) -> str:
    """Replace {name} style holes; unknown holes become empty. Tidies the spaces/punctuation that leaves behind."""
    out = re.sub(r"\{(\w+)\}", lambda m: str(vars_.get(m.group(1), "") or ""), template or "")
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\s+([।,.!?])", r"\1", out)
    return out.strip()


# ── config row ────────────────────────────────────────────────────────────────

async def _row(db: AsyncSession, key: str) -> Setting | None:
    return (await db.execute(select(Setting).where(Setting.key == key, Setting.is_deleted == False))).scalar_one_or_none()  # noqa: E712


async def _put(db: AsyncSession, key: str, value: str, secret: bool) -> None:
    row = await _row(db, key)
    if row:
        row.value, row.is_secret = value, secret
    else:
        db.add(Setting(key=key, value=value, data_type="json", is_secret=secret, is_editable=False,
                       description="WhatsApp সহকারী (Admin → WhatsApp সহকারী থেকে বদলান)"))


async def load_config(db: AsyncSession, force: bool = False, scope: str | None = None) -> dict[str, Any]:
    sc = scope if scope in SCOPES else _scope.get()
    hit = _cache.get(sc)
    if not force and hit and time.monotonic() - hit[0] < _TTL:
        return copy.deepcopy(hit[1])
    row = await _row(db, SCOPES[sc])
    if row is None and sc == "app":  # first use: the app starts from a copy of today's settings, then the two live apart
        web = await _row(db, CONFIG_KEY)
        await _put(db, SCOPES["app"], web.value if web and web.value else "{}", False)
        await db.commit()
        row = await _row(db, SCOPES["app"])
    try:
        stored = json.loads(row.value) if row and row.value else {}
    except ValueError:
        stored = {}
    cfg = deep_merge(DEFAULT_CONFIG, stored if isinstance(stored, dict) else {})
    _cache[sc] = (time.monotonic(), cfg)
    return copy.deepcopy(cfg)


async def save_config(db: AsyncSession, patch: dict[str, Any], scope: str | None = None) -> dict[str, Any]:
    """Merge a partial change from the panel (sanitised to the known shape) and store the result (in the current scope only)."""
    sc = scope if scope in SCOPES else _scope.get()
    current = await load_config(db, force=True, scope=sc)
    clean = sanitize(patch, DEFAULT_CONFIG)
    if "custom_platforms" in clean:
        clean["custom_platforms"] = platforms.normalize_custom(clean["custom_platforms"])
    if isinstance(patch.get("platforms"), dict):  # settings for a platform the owner added: same shape as the built-in ones
        known = {c["key"] for c in platforms.normalize_custom(clean.get("custom_platforms", current.get("custom_platforms")))}
        for k, v in patch["platforms"].items():
            if k in known and k not in clean.setdefault("platforms", {}):
                clean["platforms"][k] = sanitize(v, platforms.DEFAULT)
    if "places" in clean:
        from app.assistant.timectx import normalize_places
        clean["places"] = normalize_places(clean["places"])
    # lists are replaced as a whole (the panel sends the full list), dicts are merged key by key
    merged = deep_merge(current, clean)
    await _put(db, SCOPES[sc], json.dumps(merged, ensure_ascii=False), False)
    await db.commit()
    _cache.pop(sc, None)
    return merged


async def reset_section(db: AsyncSession, section: str) -> dict[str, Any]:
    if section not in DEFAULT_CONFIG:
        raise KeyError(section)
    sc = _scope.get()
    current = await load_config(db, force=True, scope=sc)
    current[section] = copy.deepcopy(DEFAULT_CONFIG[section])
    await _put(db, SCOPES[sc], json.dumps(current, ensure_ascii=False), False)
    await db.commit()
    _cache.pop(sc, None)
    return current


def invalidate() -> None:
    _cache.clear()


# ── secrets ───────────────────────────────────────────────────────────────────

async def get_secrets(db: AsyncSession) -> dict[str, str]:
    row = await _row(db, SECRETS_KEY)
    if not row or not row.value:
        return {}
    try:
        data = json.loads(_dec(row.value))
    except Exception:  # noqa: BLE001 — unreadable → treated as not set
        return {}
    return {k: str(v) for k, v in data.items() if k in SECRET_FIELDS and v}


async def save_secrets(db: AsyncSession, patch: dict[str, str]) -> dict[str, str]:
    """Only the fields that are sent (and non-empty) change; an empty value keeps what is stored."""
    data = await get_secrets(db)
    for k in SECRET_FIELDS:
        v = (patch.get(k) or "").strip()
        if v:
            data[k] = v[:600]
    await _put(db, SECRETS_KEY, _enc(json.dumps(data)), True)
    if (patch.get("token") or "").strip():  # lets the cron re-send replies that failed only because the old token was dead
        await _put(db, "wa_token_saved_at", datetime.now(timezone.utc).isoformat(timespec="seconds"), False)
    if (patch.get("app_secret") or "").strip():  # remembered so an older "signature did not match" is not blamed on the new secret
        await _put(db, "wa_app_secret_saved_at", datetime.now(timezone.utc).isoformat(timespec="seconds"), False)
    await db.commit()
    return data


async def ensure_verify_token(db: AsyncSession) -> str:
    data = await get_secrets(db)
    if not data.get("verify_token"):
        data = await save_secrets(db, {"verify_token": _secrets.token_urlsafe(18)})
    return data["verify_token"]


def masked(data: dict[str, str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for k in SECRET_FIELDS:
        v = data.get(k, "")
        out[k] = {"set": bool(v), "preview": (v if k in PLAIN_FIELDS else (("••••" + v[-4:]) if v else ""))}
    return out
