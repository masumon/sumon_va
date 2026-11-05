"""AI Hub — many AI connections, one dependable answer.

The admin adds any number of keys (Gemini, Groq, OpenRouter, NVIDIA, Cloudflare,
Mistral, Vercel AI Gateway, a local Ollama/LM Studio server, or paid OpenAI /
Claude / DeepSeek / xAI). For every call the hub:

* tries free connections first and paid ones last (paid only within a daily cap),
* ranks each connection's models for the task (chat / translate / vision /
  writing / json) by a Bangla self-test plus the real success rate and speed it
  has measured, so it "learns" which model works best,
* on a limit, outage, timeout or bad key moves on to the next model/connection
  and rests the failing one for a while.

Models are never hard-coded: they are discovered from each provider's model list
and tested when a key is added and again by the daily check, because free model
lists and limits change every month.

Storage: three rows in the settings table (no schema change) — the connection
list Fernet-encrypted as one JSON blob, plus plain JSON for stats and prefs.
The single key saved by the old "Google AI" card is migrated in automatically
and left in place, so nothing that used it stops working.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from datetime import date, datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import ai_gemini as ag
from app.assistant import ai_providers as ap
from app.core.totp_crypto import decrypt_totp_secret, encrypt_totp_secret
from app.models.models import Setting

logger = logging.getLogger(__name__)

CONN_SETTING = "ai_hub_connections_enc"
STATS_SETTING = "ai_hub_stats"
PREFS_SETTING = "ai_hub_prefs"
TASKS = ("chat", "translate", "vision", "writing", "json")
PAID_PROVIDERS = {"openai", "anthropic", "deepseek", "xai"}
DEFAULT_PREFS: dict[str, Any] = {"allow_paid": True, "paid_daily_cap": 100, "tasks": {}}

# Rest periods after a failure (seconds).
REST_BAD_KEY, REST_LIMIT, REST_ERROR = 6 * 3600, 15 * 60, 120

_VISION = re.compile(r"gemini|gpt-4o|gpt-4\.1|gpt-5|claude|llama-4|maverick|scout|vision|gemma-?[34]|qwen.*vl|-vl|pixtral|grok-4|nemotron.*vl", re.I)
_NOT_CHAT = re.compile(r"embed|whisper|tts|audio|image-gen|dall|moderation|realtime|transcri|guard|rerank|bge|sdxl|flux|stable-diff|speech|ocr-only", re.I)
_GOOD = re.compile(r"gemini|gpt|claude|llama-3\.3-70b|llama-4|qwen|gemma|deepseek|mistral|nemotron|kimi|glm|grok|gpt-oss", re.I)
_BN = re.compile(r"[ঀ-৿]")

_state: dict[str, Any] = {"at": 0.0, "conns": None, "prefs": None, "stats": None, "dirty_at": 0.0}
_rest: dict[str, float] = {}


class HubError(Exception):
    def __init__(self, message_bn: str, message_en: str, status: int = 503) -> None:
        super().__init__(message_en)
        self.message_bn, self.message_en, self.status = message_bn, message_en, status


# ── storage ──────────────────────────────────────────────────────────────────

async def _rows(db: AsyncSession, keys: list[str]) -> dict[str, Setting]:
    rows = await db.execute(select(Setting).where(Setting.key.in_(keys), Setting.is_deleted == False))  # noqa: E712
    return {s.key: s for s in rows.scalars().all()}


async def _put(db: AsyncSession, key: str, value: str, secret: bool) -> None:
    row = (await _rows(db, [key])).get(key)
    if row:
        row.value, row.is_secret = value, secret
    else:
        db.add(Setting(key=key, value=value, data_type="string", is_secret=secret, is_editable=False,
                       description="AI Hub (managed by Admin → AI সংযোগ)"))


def _today() -> str:
    return date.today().isoformat()


def _fresh_stats() -> dict[str, Any]:
    return {"day": _today(), "count": 0, "paid": 0, "per": {}, "models": {}}


async def _load(db: AsyncSession, force: bool = False) -> None:
    if not force and _state["conns"] is not None and time.monotonic() - _state["at"] < 60:
        return
    rows = await _rows(db, [CONN_SETTING, STATS_SETTING, PREFS_SETTING])
    conns: list[dict[str, Any]] = []
    enc = rows[CONN_SETTING].value if CONN_SETTING in rows else ""
    if enc:
        try:
            conns = json.loads(decrypt_totp_secret(enc)) or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("AI hub: could not read connections: %s", exc)
    try:
        prefs = {**DEFAULT_PREFS, **json.loads(rows[PREFS_SETTING].value)} if PREFS_SETTING in rows else dict(DEFAULT_PREFS)
    except ValueError:
        prefs = dict(DEFAULT_PREFS)
    # Keep in-memory stats if newer (they are only flushed every 30 s).
    stats = _state["stats"]
    if stats is None:
        try:
            stats = json.loads(rows[STATS_SETTING].value) if STATS_SETTING in rows else _fresh_stats()
        except ValueError:
            stats = _fresh_stats()
    if not conns:
        conns = await _migrate_legacy(db)
    _state.update(at=time.monotonic(), conns=conns, prefs=prefs, stats=stats)


async def _migrate_legacy(db: AsyncSession) -> list[dict[str, Any]]:
    """The single key from the old Google-AI card becomes connection #1."""
    try:
        cfg = await ag.load_config(db)
    except Exception:  # noqa: BLE001
        return []
    if not cfg.get("key"):
        return []
    prov = cfg.get("provider") or "gemini"
    model = (cfg.get("model_raw") or cfg.get("model") or "").split("@")[0]
    conn = _new_conn(prov, cfg["key"], cfg.get("base_url") or "", label="")
    conn["auth"] = cfg.get("auth") or "header"
    if model:
        conn["models"] = [{"id": model, "vision": bool(_VISION.search(model)), "score": 2, "ms": 0}]
    conn["status"], conn["note"] = "ok", "আগের সেটিং থেকে আনা হয়েছে"
    try:  # own session: never commit the caller's half-done work
        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            await _put(s, CONN_SETTING, encrypt_totp_secret(json.dumps([conn], ensure_ascii=False)), True)
            await s.commit()
    except Exception as exc:  # noqa: BLE001 — still usable from memory this time
        logger.warning("AI hub: legacy migration save failed: %s", exc)
    return [conn]


async def _save_conns(db: AsyncSession, conns: list[dict[str, Any]]) -> None:
    await _put(db, CONN_SETTING, encrypt_totp_secret(json.dumps(conns, ensure_ascii=False)), True)
    await db.commit()
    _state.update(conns=conns, at=time.monotonic())


async def _flush_stats(force: bool = False) -> None:
    """Persist stats at most every 30 s, on a separate session (never the caller's)."""
    if not force and time.monotonic() - _state["dirty_at"] < 30:
        return
    _state["dirty_at"] = time.monotonic()
    try:
        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            await _put(s, STATS_SETTING, json.dumps(_state["stats"], ensure_ascii=False), False)
            await s.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI hub: stats save failed: %s", exc)


def _stats() -> dict[str, Any]:
    st = _state["stats"] or _fresh_stats()
    if st.get("day") != _today():
        st.update(day=_today(), count=0, paid=0, per={})
    _state["stats"] = st
    return st


def _record(cid: str, model: str, task: str, ok: bool, ms: float, paid: bool) -> None:
    st = _stats()
    if ok:
        st["count"] += 1
        st["paid"] += 1 if paid else 0
        st["per"][cid] = st["per"].get(cid, 0) + 1
    m = st["models"].setdefault(f"{cid}|{model}|{task}", {"ok": 0, "fail": 0, "ms": 0})
    if ok:
        m["ms"] = round(ms if not m["ms"] else m["ms"] * 0.7 + ms * 0.3)
        m["ok"] += 1
    else:
        m["fail"] += 1
    # keep counts recent so the ranking keeps learning
    if m["ok"] + m["fail"] > 50:
        m["ok"], m["fail"] = m["ok"] // 2, m["fail"] // 2


# ── connections ──────────────────────────────────────────────────────────────

def _new_conn(provider: str, key: str, base_url: str, label: str) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:8], "provider": provider, "label": label or ap.PROVIDERS.get(provider, ap.PROVIDERS["custom"])["label"],
        "key": key.strip(), "base_url": base_url.strip(), "auth": "header", "enabled": True,
        "tier": "paid" if provider in PAID_PROVIDERS else "free", "models": [],
        "added_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "checked_at": "", "status": "new", "note": "",
    }


def _tier_order(c: dict[str, Any]) -> int:
    return 1 if c.get("tier") == "paid" else 0


def _rank(conn: dict[str, Any], model: dict[str, Any], task: str) -> float:
    m = _stats()["models"].get(f"{conn['id']}|{model['id']}|{task}") or {}
    tries = m.get("ok", 0) + m.get("fail", 0)
    rate = (m.get("ok", 0) + 1) / (tries + 2)
    ms = m.get("ms") or model.get("ms") or 3000
    speed = (1.5 if task == "chat" else 0.4) * min(ms, 20000) / 10000
    return model.get("score", 1) + 2.5 * rate - speed


def _candidates(task: str, need_vision: bool) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    prefs = _state["prefs"] or DEFAULT_PREFS
    st = _stats()
    now = time.time()
    paid_ok = prefs.get("allow_paid", True) and st["paid"] < int(prefs.get("paid_daily_cap") or 0)
    out: list[tuple[float, int, dict, dict]] = []
    for idx, c in enumerate(_state["conns"] or []):
        if not c.get("enabled") or _rest.get(c["id"], 0) > now:
            continue
        if c.get("tier") == "paid" and not paid_ok:
            continue
        for m in c.get("models") or []:
            if need_vision and not m.get("vision"):
                continue
            if _rest.get(f"{c['id']}|{m['id']}", 0) > now:
                continue
            out.append((_tier_order(c), idx, c, m))
    # free before paid; inside a tier, best measured model first (connection order breaks ties)
    out.sort(key=lambda t: (t[0], -_rank(t[2], t[3], task), t[1]))
    pairs = [(c, m) for _, _, c, m in out]
    pin = (prefs.get("tasks") or {}).get(task) or ""
    if pin and ":" in pin:
        cid, mid = pin.split(":", 1)
        pinned = [p for p in pairs if p[0]["id"] == cid and p[1]["id"] == mid]
        pairs = pinned + [p for p in pairs if p not in pinned]
    # at most two models per connection, so one dead account can't eat the whole budget
    seen: dict[str, int] = {}
    picked = []
    for c, m in pairs:
        if seen.get(c["id"], 0) < 2:
            picked.append((c, m))
            seen[c["id"]] = seen.get(c["id"], 0) + 1
    return picked


async def has_connections(db: AsyncSession) -> bool:
    await _load(db)
    return any(c.get("enabled") and c.get("models") for c in _state["conns"] or [])


# ── one call ─────────────────────────────────────────────────────────────────

async def _call(conn: dict[str, Any], model: str, system: str, user: str, *, images=None, json_mode=False,
                max_tokens=2048, timeout=60.0) -> str:
    if conn["provider"] == "gemini":
        import base64

        parts: list[dict] = [{"text": user}]
        for mime, data in images or []:
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode("ascii")}})
        gen: dict[str, Any] = {"temperature": 0.25, "maxOutputTokens": max_tokens}
        if json_mode:
            gen["responseMimeType"] = "application/json"
        headers, params = ag._auth(conn["key"], conn.get("auth") or "header")
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=8.0)) as client:
            r = await client.post(f"{ag.API_BASE}/models/{model}:generateContent", params=params, headers=headers, json={
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": parts}], "generationConfig": gen})
        if r.status_code != 200:
            raise httpx.HTTPStatusError("generate", request=r.request, response=r)
        out = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in out if not p.get("thought")).strip()
    return await ap.generate(conn["provider"], conn["key"], model, system, user, base_url=conn.get("base_url", ""),
                             max_tokens=max_tokens, json_mode=json_mode, images=images, timeout=timeout)


def _why(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"{exc.response.status_code} {ap.reason(exc) or ag._reason(exc)}".strip()
    return type(exc).__name__


async def run(db: AsyncSession, task: str, system: str, user: str, *, images=None, json_mode: bool = False,
              max_tokens: int = 2048, budget: float | None = None, meta: dict | None = None) -> str:
    """Best available answer for `task`, trying connections in order. Raises HubError."""
    await _load(db)
    task = task if task in TASKS else "json"
    need_vision = bool(images)
    pairs = _candidates(task, need_vision)
    if not pairs:
        if need_vision and any(c.get("enabled") for c in _state["conns"] or []):
            raise HubError("ছবি বুঝতে পারে এমন কোনো AI চালু নেই — Gemini বা অন্য ছবি-বোঝা AI যোগ করুন।",
                           "No connected AI can read images — add Gemini or another vision model.", 400)
        raise HubError("এই মুহূর্তে কোনো AI সংযোগ পাওয়া যাচ্ছে না — Admin → AI সংযোগ দেখুন।",
                       "No AI connection is available right now — see Admin → AI connections.", 503)
    budget = budget or (14.0 if task == "chat" else 150.0)
    per_call = 9.0 if task == "chat" else 90.0
    started = time.monotonic()
    last = ""
    for conn, model in pairs[:5]:
        left = budget - (time.monotonic() - started)
        if left < 3:
            break
        t0 = time.monotonic()
        try:
            text = await _call(conn, model["id"], system, user, images=images, json_mode=json_mode,
                               max_tokens=max_tokens, timeout=min(per_call, left))
            if not text:
                raise ValueError("empty reply")
            _record(conn["id"], model["id"], task, True, (time.monotonic() - t0) * 1000, conn.get("tier") == "paid")
            if meta is not None:
                meta.update(label=conn.get("label"), model=model["id"], ms=round((time.monotonic() - t0) * 1000))
            await _flush_stats()
            return text
        except Exception as exc:  # noqa: BLE001 — every failure just moves on to the next option
            _record(conn["id"], model["id"], task, False, 0, False)
            last = f"{conn.get('label')}: {_why(exc)}"
            code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else 0
            if code in (401, 403):
                _rest[conn["id"]] = time.time() + REST_BAD_KEY
                conn["status"], conn["note"] = "bad", "কী কাজ করছে না — নতুন কী দিন"
            elif code in (402, 429):
                _rest[conn["id"]] = time.time() + REST_LIMIT
                conn["status"], conn["note"] = "limit", "ফ্রি সীমা/ব্যালান্স শেষ — কিছুক্ষণ পরে নিজে চালু হবে"
            elif code in (400, 404):
                _rest[f"{conn['id']}|{model['id']}"] = time.time() + REST_BAD_KEY
            else:
                _rest[f"{conn['id']}|{model['id']}"] = time.time() + REST_ERROR
            logger.info("AI hub: %s/%s failed for %s: %s", conn.get("provider"), model["id"], task, _why(exc))
    await _flush_stats()
    ag._note_error(last or "সব AI সংযোগ ব্যর্থ")
    raise HubError("এই মুহূর্তে কোনো AI উত্তর দিতে পারেনি — একটু পরে আবার চেষ্টা করুন।",
                   "No AI could answer right now — please try again shortly.", 503)


# ── discovery + Bangla self-test ─────────────────────────────────────────────

PROBE_SYSTEM = 'You are a helpful assistant. Reply with JSON only: {"text": "..."}'
PROBE_USER = "বাংলায় এক বাক্যে উত্তর দিন: বাংলাদেশের রাজধানীর নাম কী?"


def _score(text: str) -> int:
    score = 1
    try:
        obj = ag.parse_json_text(text)
        t = str(obj.get("text", "")) if isinstance(obj, dict) else ""
        score += 1 if t else 0
    except ValueError:
        t = text
    letters = [ch for ch in t if ch.isalpha()]
    if letters and len(_BN.findall(t)) / len(letters) > 0.5 and "ঢাকা" in t:
        score += 1
    return score


async def _discover(conn: dict[str, Any]) -> list[str]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=8.0)) as client:
        if conn["provider"] == "gemini":
            listed = await ag._list_models(client, conn["key"], conn.get("auth") or "header")
            return list(dict.fromkeys([*listed, *ag.PREFERRED_MODELS]))[:12]
        listed = await ap.list_models(client, conn["provider"], conn["key"], conn.get("base_url", ""))
    chat = [m for m in listed if not _NOT_CHAT.search(m)]
    if conn["provider"] == "openrouter":
        chat = [m for m in chat if m.endswith(":free")] or chat
    preferred = list(ap.PROVIDERS.get(conn["provider"], {}).get("models", ()))
    first = [m for m in preferred if not listed or m in listed]
    good = sorted((m for m in chat if _GOOD.search(m)), key=lambda m: (-len(re.findall(r"\d+b", m.lower())), m))
    return list(dict.fromkeys([*first, *good, *chat]))[:12]


async def check(conn: dict[str, Any], probe_limit: int = 4) -> dict[str, Any]:
    """Discover + Bangla-test models; updates conn in place. Never raises."""
    conn["checked_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not ap.base_of(conn["provider"], conn.get("base_url", "")) and conn["provider"] != "gemini":
        conn["status"], conn["note"] = "bad", "এই সংযোগের ঠিকানা (Base URL) দরকার"
        return conn
    auths = ["header", "bearer"] if conn["provider"] == "gemini" and conn["key"].startswith("AQ.") else [conn.get("auth") or "header"]
    good: list[dict[str, Any]] = []
    bad_key = limited = False
    last = ""
    for auth in auths:
        conn["auth"] = auth
        try:
            names = await _discover(conn)
        except Exception as exc:  # noqa: BLE001
            names, last = [], _why(exc)
        if not names and conn["provider"] not in ("gemini",):
            names = list(ap.PROVIDERS.get(conn["provider"], {}).get("models", ()))[:3]
        for name in names:
            if len(good) >= probe_limit:
                break
            t0 = time.monotonic()
            try:
                text = await _call(conn, name, PROBE_SYSTEM, PROBE_USER, json_mode=True, max_tokens=512, timeout=25.0)
                good.append({"id": name, "vision": bool(_VISION.search(name)), "score": _score(text),
                             "ms": round((time.monotonic() - t0) * 1000)})
            except httpx.HTTPStatusError as exc:
                code, last = exc.response.status_code, _why(exc)
                if code in (401, 403):
                    bad_key = True
                    break
                if code == 429:  # exists, just rate-limited right now
                    limited = True
                    good.append({"id": name, "vision": bool(_VISION.search(name)), "score": 1, "ms": 0})
            except Exception as exc:  # noqa: BLE001
                last = _why(exc)
        if good:
            break
    good.sort(key=lambda m: (-m["score"], m["ms"] or 99999))
    conn["models"] = good
    if good:
        conn["status"] = "limit" if limited and all(m["ms"] == 0 for m in good) else "ok"
        best = good[0]
        conn["note"] = ("ফ্রি সীমা এই মুহূর্তে শেষ, তবে কী ঠিক আছে" if conn["status"] == "limit"
                        else f"{len(good)}টি মডেল কাজ করছে · সেরা: {best['id']}" + (" · বাংলায় ভালো" if best["score"] >= 3 else ""))
        _rest.pop(conn["id"], None)
    else:
        conn["status"] = "bad"
        conn["note"] = "কী সঠিক নয় বা অনুমতি নেই" if bad_key else f"কোনো মডেল কাজ করেনি ({last[:80]})" if last else "কোনো মডেল পাওয়া যায়নি"
    return conn


# ── admin operations ─────────────────────────────────────────────────────────

def _public(c: dict[str, Any]) -> dict[str, Any]:
    st = _stats()
    rest = _rest.get(c["id"], 0)
    return {
        "id": c["id"], "provider": c["provider"], "label": c.get("label") or c["provider"], "hint": ag.key_hint(c.get("key", "")),
        "base_url": c.get("base_url", ""), "enabled": c.get("enabled", True), "tier": c.get("tier", "free"),
        "status": c.get("status", "new"), "note": c.get("note", ""), "checked_at": c.get("checked_at", ""),
        "resting_until": datetime.fromtimestamp(rest, timezone.utc).isoformat(timespec="seconds") if rest > time.time() else "",
        "used_today": st["per"].get(c["id"], 0),
        "models": [{k: m.get(k) for k in ("id", "vision", "score", "ms")} for m in c.get("models") or []],
    }


async def summary(db: AsyncSession) -> dict[str, Any]:
    await _load(db, force=True)
    conns = _state["conns"] or []
    st = _stats()
    best = {t: (lambda p: f"{p[0]['label']} · {p[1]['id']}" if p else "")(next(iter(_candidates(t, t == "vision")), None)) for t in TASKS}
    try:
        cfg = await ag.load_config(db)
        enabled = bool(cfg.get("enabled"))
    except Exception:  # noqa: BLE001
        enabled = True
    return {
        "enabled": enabled, "connections": [_public(c) for c in conns], "prefs": _state["prefs"],
        "today": {"count": st["count"], "paid": st["paid"]}, "best": best, "last_error": ag.last_error(),
        "working": sum(1 for c in conns if c.get("enabled") and c.get("status") in ("ok", "limit") and c.get("models")),
    }


def detect(key: str) -> str:
    k = (key or "").strip()
    if k.startswith("nvapi-"):
        return "nvidia"
    if k.startswith("vck_"):
        return "vercel"
    return ap.detect(k)


async def add(db: AsyncSession, key: str, provider: str = "auto", base_url: str = "", account_id: str = "",
              label: str = "") -> dict[str, Any]:
    await _load(db, force=True)
    key = (key or "").strip()
    prov = detect(key) if provider in ("", "auto") else provider
    if prov not in ap.PROVIDERS:
        prov = "custom"
    if prov == "cloudflare":
        if not re.fullmatch(r"[0-9a-f]{32}", (account_id or "").strip()):
            raise HubError("Cloudflare-এর Account ID দিন (৩২ অক্ষরের)।", "Enter your 32-character Cloudflare Account ID.", 400)
        base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id.strip()}/ai/v1"
    if prov not in ("local", "custom") and len(key) < 12:
        raise HubError("কী-টা পুরোটা কপি করে বসান।", "Paste the whole key.", 400)
    if prov in ("local", "custom") and not base_url:
        raise HubError("সার্ভারের ঠিকানা (Base URL) দিন।", "Enter the server address (Base URL).", 400)
    conns = list(_state["conns"] or [])
    if key and any(c.get("key") == key and c.get("base_url", "") == (base_url or "") for c in conns):
        raise HubError("এই কী আগেই যোগ করা আছে।", "This key is already added.", 409)
    conn = await check(_new_conn(prov, key or "none", base_url, label))
    if conn["status"] == "bad":
        raise HubError(f"যোগ করা যায়নি — {conn['note']}", f"Could not add — {conn['note']}", 400)
    conns.append(conn)
    await _save_conns(db, conns)
    # make sure the AI switch is on once something works
    try:
        await ag._write(db, {ag.ENABLED_SETTING: ("true", False)})
        await db.commit()
        ag.invalidate()
    except Exception:  # noqa: BLE001
        pass
    return _public(conn)


def _find(cid: str) -> dict[str, Any]:
    for c in _state["conns"] or []:
        if c["id"] == cid:
            return c
    raise HubError("সংযোগ পাওয়া যায়নি।", "Connection not found.", 404)


async def retest(db: AsyncSession, cid: str) -> dict[str, Any]:
    await _load(db, force=True)
    conn = await check(_find(cid))
    await _save_conns(db, _state["conns"])
    return _public(conn)


async def update(db: AsyncSession, cid: str, *, enabled: bool | None = None, label: str | None = None,
                 move: int = 0, tier: str | None = None) -> dict[str, Any]:
    await _load(db, force=True)
    conns = list(_state["conns"] or [])
    conn = _find(cid)
    if enabled is not None:
        conn["enabled"] = enabled
    if label is not None and label.strip():
        conn["label"] = label.strip()[:60]
    if tier in ("free", "paid"):
        conn["tier"] = tier
    if move:
        i = conns.index(conn)
        j = max(0, min(len(conns) - 1, i + (1 if move > 0 else -1)))
        conns[i], conns[j] = conns[j], conns[i]
    await _save_conns(db, conns)
    return _public(conn)


async def remove(db: AsyncSession, cid: str) -> None:
    await _load(db, force=True)
    conns = [c for c in _state["conns"] or [] if c["id"] != cid]
    await _save_conns(db, conns)
    if not conns:  # the old single-key card would otherwise re-import itself
        await ag.remove_key(db)
        await db.commit()
        ag.invalidate()


async def set_prefs(db: AsyncSession, prefs: dict[str, Any]) -> dict[str, Any]:
    await _load(db, force=True)
    cur = dict(_state["prefs"] or DEFAULT_PREFS)
    if "allow_paid" in prefs:
        cur["allow_paid"] = bool(prefs["allow_paid"])
    if "paid_daily_cap" in prefs:
        cur["paid_daily_cap"] = max(0, min(int(prefs["paid_daily_cap"] or 0), 5000))
    if isinstance(prefs.get("tasks"), dict):
        cur["tasks"] = {t: str(v)[:200] for t, v in prefs["tasks"].items() if t in TASKS and v}
    await _put(db, PREFS_SETTING, json.dumps(cur, ensure_ascii=False), False)
    await db.commit()
    _state["prefs"] = cur
    return cur


async def test_all(db: AsyncSession, full: bool = True) -> list[dict[str, Any]]:
    """Re-check every enabled connection (full = rediscover models)."""
    await _load(db, force=True)
    conns = _state["conns"] or []
    targets = [c for c in conns if c.get("enabled")]
    await asyncio.gather(*(check(c, probe_limit=4 if full else 1) for c in targets))
    await _save_conns(db, conns)
    await _flush_stats(force=True)
    return [_public(c) for c in conns]


def cron_token() -> str:
    from app.core.config import settings

    return hmac.new(settings.SECRET_KEY.encode(), b"ai-hub-cron", hashlib.sha256).hexdigest()[:32]


async def daily_check(db: AsyncSession) -> dict[str, Any]:
    """Daily health check (cron-job.org). Full rediscovery once a week; e-mails the
    owner when a connection stops working."""
    await _load(db, force=True)
    before = {c["id"]: c.get("status") for c in _state["conns"] or []}
    oldest = min((c.get("checked_at") or "" for c in _state["conns"] or []), default="")
    full = not oldest or (datetime.now(timezone.utc) - datetime.fromisoformat(oldest)).days >= 7
    result = await test_all(db, full=full)
    broken = [c for c in result if c["enabled"] and c["status"] == "bad" and before.get(c["id"]) != "bad"]
    if broken:
        try:
            from app.core.config import settings
            from app.core.email import send_email

            items = "".join(f"<li><b>{c['label']}</b> — {c['note']}</li>" for c in broken)
            await send_email(settings.ADMIN_NOTIFY_EMAIL or settings.ADMIN_EMAIL, "AI সংযোগে সমস্যা — ABO Enterprise",
                             f"<p>নিচের AI সংযোগ কাজ করছে না:</p><ul>{items}</ul>"
                             "<p>Admin → AI সংযোগ পাতায় গিয়ে নতুন কী দিন। অন্য সংযোগগুলো দিয়ে AI চালু আছে।</p>")
        except Exception as exc:  # noqa: BLE001
            logger.warning("AI hub: alert e-mail failed: %s", exc)
    return {"checked": len(result), "broken": len(broken), "full": full}
