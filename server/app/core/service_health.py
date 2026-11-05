"""Extra live checks for the System Health module: Supabase, Render, cron-job.org,
Cloudflare, the public website (Vercel) and Resend.

Every ID / key / URL is read from the environment (or the existing settings) — nothing
is hardcoded. A service whose optional key is not set is reported as ``skipped`` (grey,
not counted as a failure) together with a hint on what to add.
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Setting

_T = httpx.Timeout(6.0, connect=4.0)
CRON_KEYS = {"backup": "cron_seen_backup", "ai": "cron_seen_ai", "push": "cron_seen_push", "wa": "cron_seen_wa"}


def _skip(why: str) -> dict:
    return {"ok": True, "skipped": True, "note": why}


def _fail(why: str) -> dict:
    return {"ok": False, "error": why[:240]}


async def mark_cron(db: AsyncSession, name: str) -> None:
    """Remember that cron-job.org just called one of our cron URLs (private setting)."""
    key = CRON_KEYS[name]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row:
        row.value, row.is_deleted = now, False
    else:
        db.add(Setting(key=key, value=now, data_type="string", is_secret=False, is_editable=False,
                       description="Last call from cron-job.org"))
    await db.commit()


async def _site(client: httpx.AsyncClient) -> tuple[dict, dict]:
    """Public website (Vercel) + Cloudflare in front of it, from one request."""
    url = (settings.FRONTEND_URL or "").strip().rstrip("/")
    if not url:
        return _skip("FRONTEND_URL দেওয়া নেই"), _skip("FRONTEND_URL দেওয়া নেই")
    t0 = time.time()
    try:
        r = await client.get(url + "/", follow_redirects=True)
    except Exception as exc:  # noqa: BLE001
        e = _fail(f"{urlparse(url).netloc} খোলা যাচ্ছে না: {type(exc).__name__}")
        return e, dict(e)
    ms = int((time.time() - t0) * 1000)
    h = {k.lower(): v for k, v in r.headers.items()}
    cf_on = "cf-ray" in h or h.get("server", "").lower() == "cloudflare"
    # Cloudflare's bot protection often answers a server-to-server probe (our request comes
    # from a data-centre IP) with 403/429/503 — the site itself is fine for real visitors.
    challenged = cf_on and r.status_code in (403, 429, 503)
    site = {"ok": r.status_code < 400 or challenged, "latency_ms": ms, "status": r.status_code, "host": urlparse(url).netloc,
            "host_server": "Vercel" if "x-vercel-id" in h else h.get("server", "")}
    if challenged:
        site["note"] = f"Cloudflare সুরক্ষা এই স্বয়ংক্রিয় পরীক্ষাকে আটকেছে (HTTP {r.status_code}) — সাইট পৌঁছানো গেছে, ভিজিটরদের জন্য সাধারণত ঠিক"
    elif not site["ok"]:
        site["error"] = f"ওয়েবসাইট HTTP {r.status_code} দিচ্ছে"
    cf: dict = {"ok": True, "active": cf_on, "cache": h.get("cf-cache-status", "")}
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if token:
        auth = {"Authorization": f"Bearer {token}"}
        try:
            v = await client.get("https://api.cloudflare.com/client/v4/user/tokens/verify", headers=auth)
            j = v.json() if v.content else {}
            if not j.get("success"):
                cf = _fail("Cloudflare API টোকেন কাজ করছে না — নতুন টোকেন দিন")
            else:
                cf["token"] = "valid"
                zone = os.environ.get("CLOUDFLARE_ZONE_ID", "").strip()
                if zone:
                    z = await client.get(f"https://api.cloudflare.com/client/v4/zones/{zone}", headers=auth)
                    zr = (z.json() or {}).get("result") or {}
                    cf["zone_status"] = zr.get("status", "")
                    if zr.get("status") and zr["status"] != "active":
                        cf = _fail(f"Cloudflare জোন সক্রিয় নয় (অবস্থা: {zr['status']})")
        except Exception as exc:  # noqa: BLE001
            cf = _fail(f"Cloudflare API-তে পৌঁছানো যায়নি: {type(exc).__name__}")
    elif not cf_on:
        cf = _skip("সাইট Cloudflare দিয়ে যাচ্ছে না বা টোকেন দেওয়া নেই (ঐচ্ছিক)")
    return site, cf


async def _supabase(client: httpx.AsyncClient) -> dict:
    url = (settings.SUPABASE_URL or "").strip().rstrip("/")
    if not url:
        return _skip("SUPABASE_URL দেওয়া নেই (শুধু ডাটাবেজ কানেকশন ব্যবহার হচ্ছে — ঐচ্ছিক)")
    key = settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_ROLE_KEY
    try:
        r = await client.get(f"{url}/auth/v1/health", headers={"apikey": key} if key else {})
    except Exception as exc:  # noqa: BLE001
        return _fail(f"Supabase-এ পৌঁছানো যায়নি: {type(exc).__name__}")
    if r.status_code >= 500:
        return _fail(f"Supabase সার্ভার সমস্যায় (HTTP {r.status_code}) — হয়তো প্রজেক্ট Paused")
    if r.status_code in (401, 403):
        return _fail("Supabase কী ভুল — SUPABASE_ANON_KEY মিলিয়ে নিন")
    return {"ok": True, "host": urlparse(url).netloc, "status": r.status_code}


def _render() -> dict:
    if os.environ.get("RENDER", "").lower() != "true":
        return _skip("এই সার্ভার Render-এ চলছে না (লোকাল/অন্য হোস্ট)")
    return {"ok": True, "service": os.environ.get("RENDER_SERVICE_NAME", ""),
            "commit": os.environ.get("RENDER_GIT_COMMIT", "")[:7], "branch": os.environ.get("RENDER_GIT_BRANCH", "")}


async def _cron(client: httpx.AsyncClient, db: AsyncSession) -> dict:
    rows = (await db.execute(select(Setting.key, Setting.value).where(Setting.key.in_(list(CRON_KEYS.values()))))).all()
    last = None
    for _k, v in rows:
        try:
            d = datetime.fromisoformat(v)
            last = d if last is None or d > last else last
        except ValueError:
            pass
    out: dict = {"ok": True}
    if last:
        hrs = (datetime.now(timezone.utc) - last).total_seconds() / 3600
        out["last_call_at"], out["hours_ago"] = last.isoformat(), round(hrs, 1)
        if hrs > 3:
            out = {**out, **_fail(f"cron-job.org থেকে শেষ কল এসেছে {round(hrs)} ঘণ্টা আগে — জব বন্ধ বা ভুল URL হতে পারে")}
    else:
        out = _fail("cron-job.org থেকে এখনো কোনো কল আসেনি — Backup পেজের cron URL দিয়ে জব বানান")
    key = os.environ.get("CRONJOB_API_KEY", "").strip()
    if key:
        try:
            r = await client.get("https://api.cron-job.org/jobs", headers={"Authorization": f"Bearer {key}"})
            if r.status_code == 401:
                return {**out, **_fail("CRONJOB_API_KEY ভুল")}
            jobs = (r.json() or {}).get("jobs", [])
            bad = [j.get("title") or str(j.get("url", ""))[:30] for j in jobs if j.get("enabled") and j.get("lastStatus") not in (None, 0, 1)]
            out["jobs"], out["enabled"] = len(jobs), sum(1 for j in jobs if j.get("enabled"))
            if bad:
                out = {**out, **_fail("শেষবার ব্যর্থ জব: " + ", ".join(bad[:3]))}
        except Exception as exc:  # noqa: BLE001
            out["api_note"] = f"cron-job.org API পাওয়া যায়নি: {type(exc).__name__}"
    return out


async def _resend(client: httpx.AsyncClient) -> dict:
    key = (getattr(settings, "RESEND_API_KEY", "") or "").strip()
    if not key:
        return _skip("RESEND_API_KEY দেওয়া নেই")
    try:
        r = await client.get("https://api.resend.com/domains", headers={"Authorization": f"Bearer {key}"})
    except Exception as exc:  # noqa: BLE001
        return _fail(f"Resend-এ পৌঁছানো যায়নি: {type(exc).__name__}")
    if r.status_code == 200:
        ds = (r.json() or {}).get("data", [])
        ver = [d for d in ds if d.get("status") == "verified"]
        if ds and not ver:
            return _fail("Resend-এ ডোমেইন আছে কিন্তু কোনোটি verified নয় — DNS রেকর্ড মেলান")
        return {"ok": True, "domains": len(ds), "verified": len(ver)}
    if r.status_code in (401, 403) and "restricted" in r.text.lower():
        return {"ok": True, "note": "কী বৈধ (শুধু ইমেইল পাঠানোর অনুমতি)"}
    if r.status_code in (401, 403):
        return _fail("Resend API কী ভুল বা বাতিল")
    return _fail(f"Resend HTTP {r.status_code}")


async def run_all(db: AsyncSession) -> dict[str, dict]:
    async with httpx.AsyncClient(timeout=_T, headers={"User-Agent": "ABO-SystemHealth/1.0"}) as client:
        (site, cf), sb, cron, rs = await asyncio.gather(
            _site(client), _supabase(client), _cron(client, db), _resend(client))
    return {"website": site, "cloudflare": cf, "supabase": sb, "render": _render(), "cron": cron, "resend": rs}
