import smtplib
import asyncio
import logging
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.models.models import EmailTemplate

logger = logging.getLogger(__name__)


def _send_sync(
    cfg: dict,
    to: str,
    subject: str,
    html: str,
    attachments: Optional[list] = None,
) -> None:
    """Send email synchronously using a resolved config (DB → env)."""
    if not cfg.get("host") or not cfg.get("user"):
        logger.warning("SMTP not configured, skipping email send")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{cfg['from_name']} <{cfg['from_addr']}>"
    msg["To"] = to
    msg.attach(MIMEText(html, "html", "utf-8"))

    if attachments:
        for attachment in attachments:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(attachment["content"])
            encoders.encode_base64(part)
            part.add_header(
                "Content-Disposition",
                f'attachment; filename= {attachment["filename"]}',
            )
            msg.attach(part)

    # Raises on failure so send_email's retry/failure logging can act on it.
    _timeout = 30  # seconds — prevents indefinite hangs on unreachable hosts
    if settings.DEBUG:
        logger.debug(
            "SMTP connect: host=%s port=%s tls=%s timeout=%s",
            cfg["host"], cfg["port"], cfg.get("tls"), _timeout,
        )
    use_ssl = int(cfg.get("port") or 587) == 465
    if use_ssl:
        # Port 465 uses implicit SSL (SMTP_SSL); starttls not called.
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=_timeout, context=ctx) as server:
            server.ehlo()
            if cfg.get("user") and cfg.get("password"):
                server.login(cfg["user"], cfg["password"])
            server.sendmail(cfg["from_addr"], to, msg.as_string())
    else:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=_timeout) as server:
            server.ehlo()
            if cfg.get("tls"):
                server.starttls()
            if cfg.get("user") and cfg.get("password"):
                server.login(cfg["user"], cfg["password"])
            server.sendmail(cfg["from_addr"], to, msg.as_string())
    logger.info("Email sent successfully to %s", to)


async def send_email(
    to: str,
    subject: str,
    html: str,
    attachments: Optional[list] = None,
    *,
    retries: int = 2,
) -> None:
    """Send email asynchronously with bounded exponential-backoff retries.

    SMTP failures (network blip, temp reject) shouldn't lose a customer
    notification; retry twice with 2s / 5s spacing before giving up. Runs
    inside a FastAPI BackgroundTask, so retries don't extend the API response.

    Uses configured EMAIL_PROVIDER (resend, smtp, etc).
    """
    from app.core.email_factory import get_email_provider

    delays = [2.0, 5.0]
    provider = None

    for attempt in range(retries + 1):
        try:
            if provider is None:
                provider = await get_email_provider()

            await provider.send(to, subject, html, attachments)
            if attempt:
                logger.info("Email to %s delivered on retry %d", to, attempt)
            return
        except Exception as e:
            if attempt >= retries:
                logger.error(
                    "Email to %s failed after %d attempts: %s", to, attempt + 1, e
                )
                from app.core.ops_events import record_failed_email
                record_failed_email(to, subject, str(e))
                return
            logger.warning(
                "Email to %s failed on attempt %d (%s); retrying in %.0fs",
                to, attempt + 1, e, delays[attempt],
            )
            await asyncio.sleep(delays[attempt])


from app.core import email_layout as L


def _pretty(value: str) -> str:
    """cash_on_delivery -> Cash On Delivery"""
    return (value or "").replace("_", " ").strip().title()


def _wa(number: str, text: str) -> str:
    from urllib.parse import quote

    return f"https://wa.me/{(number or '').replace('+', '')}?text={quote(text)}"


WHATSAPP = "#1fa855"


# ── Alerts to the owner ─────────────────────────────────────────────────

def order_notification_html(
    order_number: str,
    customer_name: str,
    phone: str,
    total: float,
    items_summary: str,
    payment_method: str = "",
    admin_orders_url: str = "",
    customer_whatsapp_url: str = "",
) -> str:
    rows = [("Customer", customer_name), ("Phone", phone), ("Items", items_summary)]
    if payment_method:
        rows.append(("Payment", _pretty(payment_method)))
    rows.append(("Total", f"৳{total:,.0f}"))
    body = (
        L.paragraph("A new order has been placed. Review it in the admin panel or contact the customer on WhatsApp.")
        + L.callout("Order number", order_number)
        + L.facts(rows, highlight_last=True)
        + L.buttons(
            (admin_orders_url or L.admin_url("orders"), "Open in Admin", L.BRAND),
            (customer_whatsapp_url, "WhatsApp the customer", WHATSAPP),
        )
    )
    return L.wrap_email(
        "New order received", body, preheader=f"{order_number} · {customer_name} · ৳{total:,.0f}",
        note="The invoice was created automatically. Open the order in the admin panel to download the PDF or update its status.",
    )


def booking_notification_html(booking_number: str, customer_name: str, phone: str, service_type: str, details: str, admin_url: str = "") -> str:
    body = (
        L.paragraph("A new service booking has been submitted.")
        + L.callout("Booking number", booking_number)
        + L.facts([("Customer", customer_name), ("Phone", phone), ("Service", _pretty(service_type)), ("Details", details)])
        + L.buttons((admin_url or L.admin_url("bookings"), "Open in Admin", L.BRAND))
    )
    return L.wrap_email("New booking received", body, preheader=f"{booking_number} · {customer_name}",
                        note="Open the booking in the admin panel to confirm it or update its status.")


def lead_notification_html(name: str, phone: str, lead_type: str, description: str, budget: str, admin_url: str = "") -> str:
    body = (
        L.paragraph("A new project inquiry has been submitted.")
        + L.facts([("Name", name), ("Phone", phone), ("Type", _pretty(lead_type)), ("Budget", budget), ("Description", description)])
        + L.buttons((admin_url or L.admin_url("leads"), "Open in Admin", L.BRAND))
    )
    return L.wrap_email("New project inquiry", body, preheader=f"{name} · {phone}",
                        note="Open the lead in the admin panel to follow it up.")


# ── Customer e-mails ───────────────────────────────────────────────────

def customer_order_confirmation_html(
    order_number: str,
    customer_name: str,
    items: list,
    total: float,
    whatsapp_number: str,
) -> str:
    lines = "".join(
        f'<tr><td style="padding:10px 0;border-bottom:1px solid {L.LINE};font:14px/1.4 Arial,sans-serif;color:{L.INK}">{L.esc(i["name"])}'
        f'<div style="font-size:12px;color:{L.MUTED}">Qty {L.esc(i["quantity"])}</div></td>'
        f'<td align="right" style="padding:10px 0;border-bottom:1px solid {L.LINE};font:600 14px/1.4 Arial,sans-serif;color:{L.INK};white-space:nowrap">৳{L.esc(i["price"])}</td></tr>'
        for i in items
    )
    items_table = f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0">{lines}</table>'
    body = (
        L.paragraph(f"Dear {customer_name}, thank you for your order. We have received it and are getting it ready.")
        + L.callout("Order number", order_number)
        + items_table
        + L.facts([("Total", f"৳{total:,.0f}")], highlight_last=True)
        + L.buttons((_wa(whatsapp_number, f"My order number is {order_number}"), "Chat with us on WhatsApp", WHATSAPP))
    )
    return L.wrap_email(
        "Order received", body, preheader=f"Order {order_number} — thank you!", accent="#059669",
        note="We will contact you soon with delivery updates. Thank you for shopping with ABO Enterprise.",
    )


def customer_order_status_html(
    order_number: str,
    customer_name: str,
    new_status: str,
    total: float | None = None,
    courier_provider: str | None = None,
    tracking_id: str | None = None,
    track_url: str | None = None,
) -> str:
    """Status-change notification: confirmed / processing / shipped / delivered / cancelled."""
    status_meta = {
        "confirmed":  ("Order confirmed", "#059669", "Your order has been confirmed and will be processed shortly."),
        "processing": ("Order is being prepared", "#0284c7", "Your order is being prepared for shipment."),
        "shipped":    ("Order shipped", "#7c3aed", "Your order is on its way!"),
        "delivered":  ("Order delivered", "#059669", "Your order has been delivered. Thank you for choosing ABO Enterprise!"),
        "cancelled":  ("Order cancelled", "#dc2626", "Your order has been cancelled. Contact us if this was unexpected."),
    }
    title, colour, blurb = status_meta.get(new_status, (f"Order update — {_pretty(new_status)}", L.BRAND, "Your order status has changed."))
    body = L.paragraph(f"Dear {customer_name}, {blurb[0].lower() + blurb[1:]}") + L.callout("Order number", order_number, colour)
    if new_status == "shipped" and tracking_id:
        body += L.callout(f"{_pretty(courier_provider or 'courier')} tracking ID", tracking_id, "#7c3aed")
    if total is not None:
        body += L.facts([("Order total", f"৳{total:,.0f}")], highlight_last=True)
    if track_url:
        body += L.buttons((track_url, "Track your order", L.BRAND))
    return L.wrap_email(title, body, preheader=f"Order {order_number}: {title.lower()}", accent=colour,
                        note="Questions? Reply to this e-mail or message us on WhatsApp.")


BOOKING_STATUS_META: dict[str, tuple[str, str, str]] = {
    "confirmed":   ("Booking confirmed", "#059669", "Your booking is confirmed. We'll be in touch with the next steps."),
    "in_progress": ("Work in progress", "#0284c7", "We've started work on your booking."),
    "on_hold":     ("Booking on hold", "#d97706", "Your booking is temporarily on hold. We'll contact you shortly."),
    "completed":   ("Booking completed", "#059669", "Your booking is complete. Thank you for choosing ABO Enterprise!"),
    "cancelled":   ("Booking cancelled", "#dc2626", "Your booking has been cancelled. Contact us if this was unexpected."),
}


def customer_booking_status_html(
    booking_number: str,
    customer_name: str,
    service_name: str,
    new_status: str,
    whatsapp_number: str,
) -> str:
    """Status-change notification for a service booking."""
    title, colour, blurb = BOOKING_STATUS_META.get(
        new_status, (f"Booking update — {_pretty(new_status)}", L.BRAND, "Your booking status has changed.")
    )
    body = (
        L.paragraph(f"Dear {customer_name}, {blurb[0].lower() + blurb[1:]}")
        + L.callout("Booking number", booking_number, colour, sub=service_name)
        + L.buttons((_wa(whatsapp_number, f"My booking number is {booking_number}"), "Chat with us on WhatsApp", WHATSAPP))
    )
    return L.wrap_email(title, body, preheader=f"Booking {booking_number}: {title.lower()}", accent=colour,
                        note="Thank you for choosing ABO Enterprise.")


def customer_booking_confirmation_html(
    booking_number: str,
    customer_name: str,
    service_type: str,
    estimated_price: str,
    whatsapp_number: str,
    track_url: str | None = None,
) -> str:
    body = (
        L.paragraph(f"Dear {customer_name}, we have received your booking request. Our team will review it and contact you shortly to confirm the details.")
        + L.callout("Booking number", booking_number, "#059669")
        + L.facts([("Service", service_type), ("Estimated price", estimated_price)])
        + L.buttons(
            (track_url or "", "Track your booking", L.BRAND),
            (_wa(whatsapp_number, f"My booking number is {booking_number}"), "Chat with us on WhatsApp", WHATSAPP),
        )
    )
    return L.wrap_email("Booking received", body, preheader=f"Booking {booking_number} — thank you!", accent="#059669",
                        note="We will confirm your booking details via WhatsApp or phone call.")


def customer_lead_confirmation_html(
    lead_number: str,
    customer_name: str,
    lead_type: str,
    whatsapp_number: str,
) -> str:
    body = (
        L.paragraph(f"Dear {customer_name}, thank you for your inquiry. Our team will review it and usually replies within 24 hours.")
        + L.callout("Reference number", lead_number, "#059669", sub=_pretty(lead_type))
        + L.paragraph("Want to talk about your project right now?")
        + L.buttons((_wa(whatsapp_number, f"My inquiry reference is {lead_number}"), "Chat with us on WhatsApp", WHATSAPP))
    )
    return L.wrap_email("Thank you for your inquiry", body, preheader=f"Reference {lead_number}", accent="#059669",
                        note="Thank you for considering ABO Enterprise. We look forward to working with you.")
