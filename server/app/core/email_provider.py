"""Email provider abstraction — supports multiple backends (SMTP, Resend, SendGrid, etc.)"""
from abc import ABC, abstractmethod
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Try importing Resend at module load time. The SDK is used module-level
# (`resend.api_key = ...; resend.Emails.send(...)`) — it exposes NO `Resend`
# class, so the old `from resend import Resend` always raised ImportError and
# forced an SMTP fallback (which Render's free tier blocks). Import the module.
try:
    import resend  # noqa: F401
    RESEND_AVAILABLE = True
except ImportError:
    resend = None  # type: ignore[assignment]
    RESEND_AVAILABLE = False


class EmailProvider(ABC):
    """Base interface for email providers."""

    @abstractmethod
    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        attachments: Optional[list] = None,
    ) -> None:
        """Send email. Raises on failure (caller handles retry)."""
        pass

    @abstractmethod
    def validate(self) -> bool:
        """Validate provider configuration. Return True if ready."""
        pass


class SMTPProvider(EmailProvider):
    """SMTP provider — existing implementation."""

    def __init__(self, cfg: dict):
        self.cfg = cfg

    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        attachments: Optional[list] = None,
    ) -> None:
        """Delegate to existing SMTP implementation."""
        from app.core.email import _send_sync
        import asyncio

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, _send_sync, self.cfg, to, subject, html, attachments
        )

    def validate(self) -> bool:
        return bool(self.cfg.get("host") and self.cfg.get("user") and self.cfg.get("password"))


class ResendProvider(EmailProvider):
    """Resend API provider — modern, reliable."""

    def __init__(self, api_key: str, from_email: str, from_name: str, reply_to: str = ""):
        if not RESEND_AVAILABLE:
            logger.error("Resend package not available. Install with: pip install resend")
            raise RuntimeError("Resend provider requires: pip install resend")
        # Resend rejects free-mailbox senders (gmail/yahoo/…). Warn loudly so a
        # 403 "not authorized to send from gmail.com" is obvious in the logs.
        _domain = (from_email.rsplit("@", 1)[-1] or "").lower()
        if _domain in {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "googlemail.com"}:
            logger.warning(
                "Resend sender %s uses a public mailbox domain — Resend will reject it. "
                "Set EMAIL_FROM/SMTP_FROM to an address on a domain verified in Resend.",
                from_email,
            )

        self.api_key = api_key
        self.reply_to = reply_to
        self.from_email = from_email
        self.from_name = from_name

    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        attachments: Optional[list] = None,
    ) -> None:
        """Send via Resend API."""
        if not RESEND_AVAILABLE or resend is None:
            raise RuntimeError("Resend provider not available")

        # Resend doesn't support attachments in the same way as SMTP
        # For now, we log a warning if attachments are provided
        if attachments:
            logger.warning(
                "Resend provider: attachments not yet supported, skipping %d files",
                len(attachments),
            )

        # The SDK reads the key from the module and sends via resend.Emails.send.
        # `to` must be a list of recipients.
        resend.api_key = self.api_key
        params = {
            "from": f"{self.from_name} <{self.from_email}>",
            "to": [to] if isinstance(to, str) else to,
            "subject": subject,
            "html": html,
        }
        if self.reply_to:
            params["reply_to"] = self.reply_to
        response = resend.Emails.send(params)

        # Resend returns a dict-like response with 'id' on success.
        email_id = response.get("id") if isinstance(response, dict) else getattr(response, "id", None)
        if not email_id:
            error_msg = response.get("message", "Unknown error") if isinstance(response, dict) else str(response)
            raise RuntimeError(f"Resend API error: {error_msg}")

        logger.info("Email sent via Resend to %s (id=%s)", to, email_id)

    def validate(self) -> bool:
        return bool(self.api_key and self.from_email)
