"""Talking to Meta's WhatsApp Cloud API: send a text, fetch a voice note, check the connection, verify webhooks."""
from __future__ import annotations

import hashlib
import hmac
from typing import Any

import httpx

GRAPH = "https://graph.facebook.com"
MAX_MEDIA = 8 * 1024 * 1024


class SendError(Exception):
    pass


def _ver(creds: dict[str, str]) -> str:
    v = (creds.get("graph_version") or "v26.0").strip()
    return v if v.startswith("v") else f"v{v}"


def ready(creds: dict[str, str]) -> bool:
    return bool(creds.get("token") and creds.get("phone_number_id"))


def verify_signature(app_secret: str, raw: bytes, header: str | None) -> bool:
    """Meta signs every webhook with the app secret: `X-Hub-Signature-256: sha256=<hex>`."""
    if not app_secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


def _why(r: httpx.Response) -> str:
    try:
        err = (r.json().get("error") or {})
        return f"{r.status_code} {err.get('message', '')}"[:280]
    except Exception:  # noqa: BLE001
        return f"{r.status_code}"


async def send_text(creds: dict[str, str], to: str, body: str) -> str:
    """Returns the WhatsApp message id; raises SendError with a short reason."""
    if not ready(creds):
        raise SendError("Meta সংযোগ এখনও বসানো হয়নি")
    url = f"{GRAPH}/{_ver(creds)}/{creds['phone_number_id']}/messages"
    payload = {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": body[:3800], "preview_url": False}}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=6.0)) as client:
            r = await client.post(url, json=payload, headers={"Authorization": f"Bearer {creds['token']}"})
    except httpx.HTTPError as exc:
        raise SendError(f"নেটওয়ার্ক ত্রুটি: {type(exc).__name__}") from exc
    if r.status_code != 200:
        raise SendError(send_reason(_err(r)))
    return ((r.json().get("messages") or [{}])[0]).get("id") or ""


SEND_REASONS = {  # Meta's sending error codes → what the owner should do
    190: "টোকেনের মেয়াদ শেষ বা ভুল — System user-এর স্থায়ী টোকেন বানিয়ে বসান",
    131005: "Meta এই টোকেনকে বার্তা পাঠাতে দিচ্ছে না (অনুমতি নেই) — System user-এর স্থায়ী টোকেন বানান, তাতে অ্যাপ ও এই WhatsApp অ্যাকাউন্ট যোগ করে দুটি অনুমতি দিন",
    131030: "এই নম্বর পরীক্ষার নম্বরের প্রাপক-তালিকায় নেই — Meta-র API Setup পাতায় নম্বরটি যোগ করুন",
    131047: "২৪ ঘণ্টা পার — ব্যক্তি আবার লিখলে তবে উত্তর দেওয়া যাবে",
    131026: "নম্বরটি WhatsApp-এ নেই বা বার্তা নিতে পারছে না",
    131056: "একই ব্যক্তিকে খুব দ্রুত পরপর বার্তা গেছে — কয়েক সেকেন্ড পরে নিজে নিজে আবার চেষ্টা হয়",
    130429: "Meta কিছুক্ষণের জন্য পাঠানো সীমিত করেছে — একটু পরে আবার চেষ্টা করুন",
}


def send_reason(err: dict[str, Any]) -> str:
    """Plain Bangla reason + Meta's own words, so a failed reply always says what to do."""
    code = err.get("code")
    head = SEND_REASONS.get(code) or ("টোকেনের মেয়াদ শেষ — নতুন স্থায়ী টোকেন বসান" if err.get("status") == 401 else "Meta বার্তাটি নেয়নি")
    return f"{head} (Meta: #{code} {err.get('message', '')})"[:290]


async def fetch_media(creds: dict[str, str], media_id: str) -> tuple[str, bytes]:
    """Download a voice note/photo. Capped at 8 MB."""
    if not ready(creds):
        raise SendError("Meta সংযোগ নেই")
    headers = {"Authorization": f"Bearer {creds['token']}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=6.0)) as client:
            meta = await client.get(f"{GRAPH}/{_ver(creds)}/{media_id}", headers=headers)
            if meta.status_code != 200:
                raise SendError(_why(meta))
            info = meta.json()
            if int(info.get("file_size") or 0) > MAX_MEDIA:
                raise SendError("ফাইল অনেক বড়")
            r = await client.get(info["url"], headers=headers)
    except httpx.HTTPError as exc:
        raise SendError(f"নেটওয়ার্ক ত্রুটি: {type(exc).__name__}") from exc
    if r.status_code != 200 or len(r.content) > MAX_MEDIA:
        raise SendError(_why(r))
    mime = (info.get("mime_type") or "audio/ogg").split(";")[0]
    return mime, r.content


async def check(creds: dict[str, str]) -> dict[str, Any]:
    """Ask Meta about the phone number id — proves the id and token work together."""
    if not ready(creds):
        return {"ok": False, "message": "প্রথমে Phone Number ID আর Access Token বসান"}
    url = f"{GRAPH}/{_ver(creds)}/{creds['phone_number_id']}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=6.0)) as client:
            r = await client.get(url, params={"fields": "display_phone_number,verified_name,quality_rating"},
                                 headers={"Authorization": f"Bearer {creds['token']}"})
    except httpx.HTTPError as exc:
        return {"ok": False, "message": f"নেটওয়ার্ক ত্রুটি: {type(exc).__name__}"}
    if r.status_code != 200:
        return {"ok": False, "message": f"Meta বলছে: {_why(r)}"}
    d = r.json()
    return {"ok": True, "message": "সংযোগ ঠিক আছে", "number": d.get("display_phone_number"), "name": d.get("verified_name"), "quality": d.get("quality_rating")}


# ── read-only checks used by the setup health panel ────────────────────────────────

def _err(r: httpx.Response) -> dict[str, Any]:
    try:
        e = r.json().get("error") or {}
    except Exception:  # noqa: BLE001
        e = {}
    return {"status": r.status_code, "code": e.get("code"), "subcode": e.get("error_subcode"), "message": str(e.get("message") or "")[:300]}


async def graph_get(creds: dict[str, str], path: str, params: dict[str, str] | None = None, token: str | None = None) -> tuple[bool, dict[str, Any]]:
    """GET on the Graph API. Returns (ok, json) or (False, {"error": {...}}). Never raises."""
    url = f"{GRAPH}/{_ver(creds)}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=6.0)) as client:
            r = await client.get(url, params=params or {}, headers={"Authorization": f"Bearer {token or creds.get('token', '')}"})
    except httpx.HTTPError as exc:
        return False, {"error": {"status": 0, "code": None, "subcode": None, "message": f"নেটওয়ার্ক ত্রুটি: {type(exc).__name__}"}}
    if r.status_code != 200:
        return False, {"error": _err(r)}
    return True, r.json()


async def graph_post(creds: dict[str, str], path: str, data: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    """POST to the Graph API (used only for the owner's own "connect webhook" button). Never raises."""
    url = f"{GRAPH}/{_ver(creds)}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0)) as client:
            r = await client.post(url, json=data, headers={"Authorization": f"Bearer {creds.get('token', '')}"})
    except httpx.HTTPError as exc:
        return False, {"error": {"status": 0, "code": None, "subcode": None, "message": f"নেটওয়ার্ক ত্রুটি: {type(exc).__name__}"}}
    if r.status_code != 200:
        return False, {"error": _err(r)}
    return True, r.json()


def explain(err: dict[str, Any]) -> str:
    """Meta's error in plain Bangla (the raw Meta text is always shown next to it)."""
    code, status, msg = err.get("code"), err.get("status"), (err.get("message") or "").lower()
    if status == 0:
        return "সার্ভার থেকে Meta-র সঙ্গে যোগাযোগ করা যায়নি। একটু পরে আবার চেষ্টা করুন।"
    if code == 190 or ("access token" in msg and ("expired" in msg or "invalid" in msg or "parse" in msg)):
        return "Access Token ভুল বা মেয়াদ শেষ। নতুন স্থায়ী টোকেন বানিয়ে বসান।"
    if code in (10, 200, 299) or "permission" in msg:
        return "টোকেনের অনুমতি কম। টোকেন বানানোর সময় whatsapp_business_messaging ও whatsapp_business_management দুটোই টিক দিতে হবে, আর অ্যাপটি System user-এর অ্যাসেটে যোগ থাকতে হবে।"
    if code == 100 or "does not exist" in msg or "unsupported get" in msg:
        return "Phone Number ID ভুল, অথবা এই টোকেন ওই নম্বর দেখার অধিকার রাখে না। ID আবার কপি করুন এবং System user-কে WhatsApp অ্যাকাউন্ট যোগ করুন।"
    if code in (4, 17, 32, 613, 80007) or status == 429:
        return "Meta কিছুক্ষণের জন্য অনুরোধ সীমিত করেছে। ১০ মিনিট পরে আবার চেষ্টা করুন।"
    return "Meta একটি সমস্যা জানিয়েছে। নিচের Meta-র লেখাটি দেখুন।"
