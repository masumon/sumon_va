"""Channel connectors for the unified inbox.

Every way a person can reach the owner (WhatsApp, Telegram, SMS, other apps seen by the phone bridge, e-mail, a generic
webhook) is a *channel*. A channel only knows two things: how to bring a message in (`ingest.ingest`) and how to send a reply
back out (`dispatch.deliver_other`). The thinking (wa_brain), the per-person rules, the limits and the kill switch are shared,
so adding a channel never touches the brain.

`wa_flow` keeps its own WhatsApp send path untouched; everything else goes through here.
"""
from __future__ import annotations

from typing import Any

# key -> (label shown to the owner, may the assistant answer on its own, short icon)
CHANNELS: dict[str, tuple[str, bool, str]] = {
    "whatsapp": ("WhatsApp", True, "💬"),
    "telegram": ("Telegram", True, "✈️"),
    "sms": ("SMS", True, "✉️"),
    "notif": ("ফোনের অ্যাপ", False, "📱"),   # WhatsApp/Messenger/IMO/... seen through phone notifications: never auto-sent
    "email": ("ইমেইল", False, "📧"),
    "webhook": ("ওয়েবহুক", False, "🔗"),
}


def label(channel: str) -> str:
    return CHANNELS.get(channel, (channel, False, "💬"))[0]


def icon(channel: str) -> str:
    return CHANNELS.get(channel, (channel, False, "💬"))[2]


def auto_allowed(cfg: dict[str, Any], channel: str) -> bool:
    """May the assistant send replies by itself on this channel? Bridge-only channels never can."""
    if channel == "whatsapp":
        return True
    ch = cfg.get("channels") or {}
    if channel == "telegram":
        return bool((ch.get("telegram") or {}).get("enabled") and (ch.get("telegram") or {}).get("auto"))
    if channel == "sms":
        return bool((ch.get("device") or {}).get("enabled") and (ch.get("device") or {}).get("auto_sms"))
    return False
