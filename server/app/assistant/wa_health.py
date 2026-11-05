"""Real, plain-language health check of the WhatsApp assistant setup.

Each item is a true test (a live call to Meta, a real webhook Meta has already sent us, the last cron call …), never
just "a field is filled". state: ok (green tick) | warn (amber) | bad (red, with the real reason) | todo (not done yet).
`fix` points to where the owner can put it right: an outside page ("href"), a page of this admin ("path") or a place
inside this panel ("tab").
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import wa_config as wcfg
from app.assistant import wa_flow as flow
from app.assistant import wa_send
from app.models.wa import WaContact

REQUIRED_SCOPES = ("whatsapp_business_messaging", "whatsapp_business_management")
HOOK_OK, HOOK_BAD, HOOK_VERIFIED = "wa_hook_ok_at", "wa_hook_bad_at", "wa_hook_verified_at"
_last_write: dict[str, float] = {}

META_APPS = "https://developers.facebook.com/apps"
SYSTEM_USERS = "https://business.facebook.com/settings/system-users"
CRON_CONSOLE = "https://console.cron-job.org/"
NEW_TOKEN = {"label": "নতুন টোকেন বানান", "href": SYSTEM_USERS}
GO_FORM = {"label": "নিচের ফর্মে যান", "tab": "secrets"}


async def record(db: AsyncSession, key: str) -> None:
    """Remember "this just happened" (at most once a minute per kind, so a burst never hammers the database)."""
    if time.monotonic() - _last_write.get(key, -999.0) < 60:
        return
    _last_write[key] = time.monotonic()
    try:
        await flow._set_val(db, key, datetime.now(timezone.utc).isoformat(timespec="seconds"))
        await db.commit()
    except Exception:  # noqa: BLE001 — bookkeeping must never break the webhook
        await db.rollback()


EVENTS_KEY = "wa_recent_events"


def summarize(payload: dict[str, Any]) -> list[str]:
    """One short plain line per change Meta sent (what kind of thing, never the message text or numbers)."""
    out: list[str] = []
    for entry in payload.get("entry") or []:
        for ch in entry.get("changes") or []:
            val = ch.get("value") or {}
            parts = []
            if val.get("messages"):
                parts.append("বার্তা: " + ", ".join(sorted({str(m.get("type", "?")) for m in val["messages"]})))
            if val.get("statuses"):
                parts.append("অবস্থা: " + ", ".join(sorted({str(x.get("status", "?")) for x in val["statuses"]})))
            if val.get("message_echoes"):
                parts.append("আপনার ফোন থেকে পাঠানো বার্তা")
            if val.get("history"):
                parts.append("পুরনো চ্যাটের ইতিহাস")
            if val.get("state_sync"):
                parts.append("ফোনের কন্ট্যাক্ট")
            if val.get("event"):
                parts.append("ঘটনা: " + str(val["event"])[:40])
            ph = str((val.get("metadata") or {}).get("phone_number_id") or "")
            out.append(f"{ch.get('field', '?')} · " + (" · ".join(parts) or "অন্য ধরনের তথ্য") + (f" · নম্বর …{ph[-4:]}" if ph else ""))
    return out or ["খালি বা চেনা যায়নি"]


async def log_events(db: AsyncSession, lines: list[str], throttle: str | None = None) -> None:
    """Keep the last 20 things Meta sent, so the setup panel can show what really arrived."""
    if throttle:  # unsigned/garbage requests may come from anyone: log at most one per minute
        if time.monotonic() - _last_write.get(throttle, -999.0) < 60:
            return
        _last_write[throttle] = time.monotonic()
    try:
        old = json.loads(await flow._get_val(db, EVENTS_KEY) or "[]")
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        await flow._set_val(db, EVENTS_KEY, json.dumps(([{"at": now, "text": t} for t in lines] + (old if isinstance(old, list) else []))[:20], ensure_ascii=False))
        await db.commit()
    except Exception:  # noqa: BLE001 — a diagnostic must never break the webhook
        await db.rollback()


async def recent_events(db: AsyncSession) -> list[dict[str, str]]:
    try:
        data = json.loads(await flow._get_val(db, EVENTS_KEY) or "[]")
    except ValueError:
        return []
    return [x for x in data if isinstance(x, dict)][:20]


def _t(v: str | None) -> datetime | None:
    try:
        d = datetime.fromisoformat(v) if v else None
    except ValueError:
        return None
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def _item(key: str, title: str, state: str, detail: str, fix: dict[str, str] | None = None, meta: str = "") -> dict[str, Any]:
    return {"key": key, "title": title, "state": state, "detail": detail, "fix": fix, "meta": meta}


def _ago(d: datetime | None) -> str:
    if not d:
        return ""
    mins = int((datetime.now(timezone.utc) - d).total_seconds() // 60)
    if mins < 1:
        return "এইমাত্র"
    if mins < 90:
        return f"{mins} মিনিট আগে"
    return f"{mins // 60} ঘণ্টা আগে" if mins < 2880 else f"{mins // 1440} দিন আগে"


def _app_fix(app_id: str) -> dict[str, str]:
    return {"label": "Meta অ্যাপ খুলুন", "href": f"{META_APPS}/{app_id}/" if app_id else META_APPS}


async def build(db: AsyncSession, remote: bool) -> dict[str, Any]:
    cfg = await wcfg.load_config(db, force=True)
    creds = await wcfg.get_secrets(db)
    items: list[dict[str, Any]] = []
    app_id = ""

    # 1 · database tables (SQL 0055)
    try:
        await db.execute(select(func.count()).select_from(WaContact))
        items.append(_item("db", "ডাটাবেসের টেবিল", "ok", "সহকারীর চারটি টেবিল তৈরি আছে।"))
    except Exception:  # noqa: BLE001
        await db.rollback()
        items.append(_item("db", "ডাটাবেসের টেবিল", "bad", "টেবিল পাওয়া যাচ্ছে না। Supabase → SQL Editor-এ manual_sql/0055_wa_assistant.sql চালান।",
                           {"label": "Supabase খুলুন", "href": "https://supabase.com/dashboard"}))

    # 2 · what is filled in
    have_ids = bool(creds.get("phone_number_id") and creds.get("token"))
    items.append(_item("creds", "Phone Number ID ও Access Token", "ok" if have_ids else "todo",
                       "দুটোই বসানো আছে।" if have_ids else "এখনও বসানো হয়নি। Meta-র API Setup পাতা থেকে নিয়ে নিচের ফর্মে বসান।",
                       None if have_ids else GO_FORM))
    items.append(_item("secret", "App Secret", "ok" if creds.get("app_secret") else "todo",
                       "বসানো আছে।" if creds.get("app_secret") else "বসানো নেই। এটি ছাড়া Meta-র আসল বার্তা নেওয়া হয় না (নিরাপত্তার জন্য)।",
                       None if creds.get("app_secret") else {"label": "Meta অ্যাপ খুলুন", "href": META_APPS}))

    # 3 · live call to Meta, 4 · token validity, 7 · subscription
    if not have_ids:
        items.append(_item("meta", "Meta-র সঙ্গে সত্যিকার সংযোগ", "todo", "আগে ওপরের তথ্য বসান।"))
    elif not remote:
        items.append(_item("meta", "Meta-র সঙ্গে সত্যিকার সংযোগ", "todo", "“এখনই পরীক্ষা করুন” চাপুন।"))
    else:
        ok, data = await wa_send.graph_get(creds, creds["phone_number_id"], {"fields": "display_phone_number,verified_name,quality_rating"})
        if ok:
            q = str(data.get("quality_rating") or "")
            items.append(_item("meta", "Meta-র সঙ্গে সত্যিকার সংযোগ", "ok", f"সংযুক্ত: {data.get('display_phone_number', '')} ({data.get('verified_name', '')})।",
                               meta=f"নম্বরের মান: {q}" if q else ""))
        else:
            e = data["error"]
            items.append(_item("meta", "Meta-র সঙ্গে সত্যিকার সংযোগ", "bad", wa_send.explain(e), NEW_TOKEN, meta=f"Meta বলেছে: {e.get('message') or e.get('status')}"))

        ok, dbg = await wa_send.graph_get(creds, "debug_token", {"input_token": creds["token"]})
        d = (dbg.get("data") or {}) if ok else {}
        app_id = str(d.get("app_id") or "")
        if not ok or not d:
            items.append(_item("token", "টোকেনের মেয়াদ ও অনুমতি", "warn", "টোকেনটি পরীক্ষা করা যায়নি। ওপরের সংযোগ ঠিক থাকলে এটি জরুরি নয়।"))
        else:
            missing = [s for s in REQUIRED_SCOPES if s not in set(d.get("scopes") or [])]
            exp = int(d.get("expires_at") or 0)
            left = (datetime.fromtimestamp(exp, tz=timezone.utc) - datetime.now(timezone.utc)) if exp else None
            if not d.get("is_valid", True):
                items.append(_item("token", "টোকেনের মেয়াদ ও অনুমতি", "bad", "টোকেন আর চলে না। নতুন স্থায়ী টোকেন বানান।", NEW_TOKEN))
            elif missing:
                items.append(_item("token", "টোকেনের মেয়াদ ও অনুমতি", "bad", "টোকেনে এই অনুমতি নেই: " + ", ".join(missing) + "। নতুন টোকেন বানানোর সময় দুটোই টিক দিন।", NEW_TOKEN))
            elif left is not None and left < timedelta(days=7):
                items.append(_item("token", "টোকেনের মেয়াদ ও অনুমতি", "warn", f"টোকেনের মেয়াদ প্রায় শেষ ({max(0, left.days)} দিন বাকি)। স্থায়ী টোকেন বানিয়ে নিন।", NEW_TOKEN))
            else:
                items.append(_item("token", "টোকেনের মেয়াদ ও অনুমতি", "ok", "অনুমতি ঠিক আছে, " + ("মেয়াদ নেই (স্থায়ী)।" if left is None else f"মেয়াদ আছে আরও {left.days} দিন।")))

        if app_id and creds.get("app_secret"):
            # Meta itself tells us whether this App Secret belongs to this app: "app_id|app_secret" is the app's own key.
            okk, res = await wa_send.graph_get(creds, app_id, {"fields": "id"}, token=f"{app_id}|{creds['app_secret']}")
            items[:] = [i for i in items if i["key"] != "secret"]
            at = next((n for n, i in enumerate(items) if i["key"] == "creds"), len(items) - 1) + 1
            if okk:
                items.insert(at, _item("secret", "App Secret", "ok", "Meta যাচাই করেছে: এই App Secret আপনার অ্যাপের সঠিক সিক্রেট।"))
            else:
                e = res["error"]
                items.insert(at, _item("secret", "App Secret", "bad", "Meta বলছে এই App Secret আপনার অ্যাপের সিক্রেট নয় (ভুল, পুরনো, বা রিসেটের আগের)। Meta অ্যাপ → App settings → Basic → App secret → Show থেকে এখনকার সিক্রেট কপি করে নিচের ফর্মে বসান।",
                                       GO_FORM, meta=f"Meta বলেছে: {e.get('message') or e.get('status')}"))

        if creds.get("waba_id"):
            ok, sub = await wa_send.graph_get(creds, f"{creds['waba_id']}/subscribed_apps")
            if ok and (sub.get("data") or []):
                items.append(_item("subscribed", "অ্যাপ এই WhatsApp অ্যাকাউন্টের বার্তা পায়", "ok", "Meta আপনার অ্যাপকে এই অ্যাকাউন্টের বার্তা পাঠাতে সাবস্ক্রাইব করেছে।"))
            elif ok:
                items.append(_item("subscribed", "অ্যাপ এই WhatsApp অ্যাকাউন্টের বার্তা পায়", "bad",
                                   "কোনো অ্যাপ সাবস্ক্রাইব করা নেই। Meta → WhatsApp → Configuration → Webhook fields-এ “messages” সাবস্ক্রাইব করুন।", _app_fix(app_id)))
            else:
                items.append(_item("subscribed", "অ্যাপ এই WhatsApp অ্যাকাউন্টের বার্তা পায়", "warn",
                                   wa_send.explain(sub["error"]) + " (WhatsApp Business Account ID ঠিক আছে কি দেখুন)", None, f"Meta বলেছে: {sub['error'].get('message')}"))
        else:
            items.append(_item("subscribed", "অ্যাপ এই WhatsApp অ্যাকাউন্টের বার্তা পায়", "warn", "WhatsApp Business Account ID বসালে এটিও যাচাই করা যাবে (ঐচ্ছিক)।", GO_FORM))

    # coexistence: is the number also on the phone app, was the link lost, did old chats come in
    if remote and have_ids:
        okc, pn = await wa_send.graph_get(creds, creds["phone_number_id"], {"fields": "is_on_biz_app,platform_type"})
        if okc and pn.get("is_on_biz_app") is True:
            items.append(_item("coexist", "ফোনের WhatsApp Business অ্যাপও চালু (coexistence)", "ok",
                               "নম্বরটি ফোনের অ্যাপ ও সহকারী দুটোতেই আছে। ফোনের অ্যাপ অন্তত ১৩ দিনে একবার খুলুন, নইলে সংযোগ কেটে যায়।"))
        elif okc and cfg["readiness"].get("target") == "main":
            items.append(_item("coexist", "ফোনের WhatsApp Business অ্যাপও চালু (coexistence)", "bad",
                               "মূল নম্বর বাছা আছে কিন্তু Meta বলছে নম্বরটি ফোনের অ্যাপে নেই। চ্যাট বাঁচাতে coexistence পথে আবার যুক্ত করুন।", {"label": "তালিকায় যান", "tab": "readiness"}))
        elif okc:
            items.append(_item("coexist", "ফোনের WhatsApp Business অ্যাপও চালু (coexistence)", "ok", "এটি শুধু API নম্বর (পরীক্ষার), ফোনের অ্যাপে নেই — পরীক্ষার জন্য ঠিকই আছে।"))
    lost = await flow._get_val(db, "wa_connection_lost")
    if lost:
        items.append(_item("lost", "সংযোগ কেটে যাওয়ার খবর", "bad", f"Meta জানিয়েছে সংযোগ কেটেছে: {lost}। আবার যুক্ত না করলে সহকারী উত্তর দেবে না।", {"label": "তালিকায় যান", "tab": "readiness"}))
    try:
        hs = json.loads(await flow._get_val(db, "wa_history_state") or "{}")
    except ValueError:
        hs = {}
    if hs:
        if hs.get("count"):
            items.append(_item("history", "পুরনো চ্যাটের ইতিহাস আনা", "ok", f"{hs['count']}টি পুরনো বার্তা আনা হয়েছে" + (f" ({hs['progress']}%)" if hs.get("progress") is not None else "") + "। এগুলোতে সহকারী কাউকে উত্তর দেয় না।"))
        elif hs.get("declined"):
            items.append(_item("history", "পুরনো চ্যাটের ইতিহাস আনা", "warn", "আপনি ইতিহাস শেয়ার করেননি, তাই শুধু নতুন বার্তা আসবে। সহকারী ধীরে ধীরে শিখবে।"))

    # 5/6 · what Meta has really done to us
    ver, hok, hbad = _t(await flow._get_val(db, HOOK_VERIFIED)), _t(await flow._get_val(db, HOOK_OK)), _t(await flow._get_val(db, HOOK_BAD))
    items.append(_item("verified", "Meta আমাদের Webhook ঠিকানা যাচাই করেছে", "ok" if ver else "todo",
                       f"হ্যাঁ, {_ago(ver)}।" if ver else "এখনও না। Meta → WhatsApp → Configuration → Webhook-এ Callback URL ও Verify token বসিয়ে “Verify and save” চাপুন।",
                       None if ver else _app_fix(app_id)))
    saved = _t(await flow._get_val(db, "wa_app_secret_saved_at"))
    if hbad and saved and hbad < saved and (not hok or hok < saved):
        # the failed delivery happened before the owner saved a new App Secret — wait for a fresh message instead of blaming the new one
        items.append(_item("incoming", "Meta থেকে আসল বার্তা এসেছে", "todo",
                           f"আগের একটি বার্তায় স্বাক্ষর মেলেনি ({_ago(hbad)}), তখন পুরনো App Secret ছিল। নতুন App Secret বসানো হয়েছে ({_ago(saved)}) — এখন একটি নতুন মেসেজ দিন, তখন এটি সবুজ হবে।"))
    elif hbad and (not hok or hbad > hok):
        items.append(_item("incoming", "Meta থেকে আসল বার্তা এসেছে", "bad",
                           f"Meta বার্তা পাঠিয়েছে ({_ago(hbad)}) কিন্তু App Secret মেলেনি, তাই নেওয়া হয়নি। সঠিক App Secret আবার বসান।", GO_FORM))
    elif hok:
        items.append(_item("incoming", "Meta থেকে আসল বার্তা এসেছে", "ok", f"হ্যাঁ, শেষবার {_ago(hok)}।"))
    else:
        items.append(_item("incoming", "Meta থেকে আসল বার্তা এসেছে", "todo", "এখনও কোনো বার্তা আসেনি। অন্য ফোন থেকে এই নম্বরে একটি মেসেজ দিন।"))

    # 8 · cron
    seen = _t(await flow._get_val(db, "cron_seen_wa"))
    cron_fix = {"label": "cron-job.org খুলুন", "href": CRON_CONSOLE}
    if not seen:
        items.append(_item("cron", "cron-job.org প্রতি মিনিটে চলছে", "todo", "এখনও কোনো কল আসেনি। cron-job.org-এ নিচের লিংকটি প্রতি ১ মিনিটে চালান।", cron_fix))
    elif datetime.now(timezone.utc) - seen > timedelta(minutes=5):
        items.append(_item("cron", "cron-job.org প্রতি মিনিটে চলছে", "bad", f"শেষ কল এসেছে {_ago(seen)}। জবটি বন্ধ বা ভুল লিংকে আছে। দেরিতে উত্তর পাঠানো আটকে যাবে।", cron_fix))
    else:
        items.append(_item("cron", "cron-job.org প্রতি মিনিটে চলছে", "ok", f"হ্যাঁ, শেষ কল {_ago(seen)}।"))

    # 9 · AI
    try:
        from app.assistant import ai_hub

        has_ai = await ai_hub.has_connections(db)
    except Exception:  # noqa: BLE001
        has_ai = False
    items.append(_item("ai", "AI সংযোগ", "ok" if has_ai else "warn",
                       "AI চালু আছে (বার্তার সারাংশ, করণীয় ও ভয়েস বুঝতে)।" if has_ai else "কোনো AI সংযোগ নেই। সহকারী তবুও নিয়ম মেনে কাজ করবে, শুধু সারাংশ ও ভয়েস-বোঝা পাবেন না।",
                       None if has_ai else {"label": "AI সংযোগ যোগ করুন", "path": "/sumon/ai"}))

    # 10 · main-number guard, and switched on
    main = cfg["readiness"].get("target") == "main"
    problem = wcfg.readiness_problem({**cfg, "enabled": True}) if main else None
    if problem:
        items.append(_item("safety", "মূল নম্বরের নিরাপত্তা-তালিকা", "bad", problem, {"label": "তালিকায় যান", "tab": "readiness"}))
    else:
        items.append(_item("safety", "মূল নম্বরের নিরাপত্তা-তালিকা", "ok", "সব ঘরে টিক আছে।" if main else "পরীক্ষার নম্বর বেছে আছেন, তাই আপনার মূল চ্যাটে কোনো ঝুঁকি নেই।"))
    if cfg["enabled"]:
        items.append(_item("enabled", "সহকারী চালু", "ok", "চালু, মোড: " + ("নিজে উত্তর পাঠাবে।" if cfg["mode"] == "auto" else "শুধু খসড়া (কিছু পাঠায় না)।")))
    else:
        items.append(_item("enabled", "সহকারী চালু", "todo", "বন্ধ আছে। সব ঠিক হলে ওপরের “চালু করুন” চাপুন।"))

    core = [i for i in items if i["key"] in ("db", "creds", "secret", "meta", "token", "verified", "incoming", "cron")]
    bad = sum(1 for i in core if i["state"] == "bad")
    todo = sum(1 for i in core if i["state"] == "todo")
    return {"items": items, "summary": "bad" if bad else "todo" if todo else "ok", "bad": bad, "todo": todo, "remote": remote,
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
