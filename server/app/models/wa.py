"""Sumon's personal WhatsApp assistant: contacts, messages, notes and tasks (manual_sql/0055)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class WaContact(Base):
    """One person who messages the number. `mode`: inherit (global) | auto | draft | notify."""

    __tablename__ = "wa_contacts"

    id: Mapped[uuid.UUID] = _id()
    phone: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)  # phone, or "tg:<id>", "sms:<no>", "mail:<addr>" for other channels
    channel: Mapped[str] = mapped_column(String(16), default="whatsapp", index=True)
    category: Mapped[str | None] = mapped_column(String(10), index=True)  # business | personal | social | spam
    tags: Mapped[list | None] = mapped_column(JSON)  # [{"label": "ক্লায়েন্ট", "value": "", "important": true}] — the owner's own notes about this person
    name: Mapped[str | None] = mapped_column(String(120))
    calls_him: Mapped[str | None] = mapped_column(String(40))
    relation: Mapped[str | None] = mapped_column(String(40))
    gender: Mapped[str | None] = mapped_column(String(10))
    mode: Mapped[str] = mapped_column(String(10), default="inherit")
    is_vip: Mapped[bool] = mapped_column(Boolean, default=False)
    is_family: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    # assistant (assistant answers) | owner (Sumon took over) | done (resolved)
    state: Mapped[str] = mapped_column(String(10), default="assistant", index=True)
    hold_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[int] = mapped_column(SmallInteger, default=5)
    need: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    profile: Mapped[dict | None] = mapped_column(JSON)
    unread: Mapped[int] = mapped_column(Integer, default=0)
    lang: Mapped[str | None] = mapped_column(String(5))
    last_inbound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_outbound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class WaMessage(Base):
    """direction in|out. status: received | draft | queued | sent | failed | skipped | discarded."""

    __tablename__ = "wa_messages"

    id: Mapped[uuid.UUID] = _id()
    contact_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("wa_contacts.id", ondelete="CASCADE"), nullable=False)
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default="whatsapp")
    wa_id: Mapped[str | None] = mapped_column(String(120), unique=True)
    kind: Mapped[str] = mapped_column(String(12), default="text")
    body: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="received")
    reason: Mapped[str | None] = mapped_column(String(40))
    send_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery: Mapped[str | None] = mapped_column(String(12))
    error: Mapped[str | None] = mapped_column(String(300))
    meta: Mapped[dict | None] = mapped_column(JSON)
    feedback: Mapped[int | None] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WaNote(Base):
    """Owner-written fact the assistant may tell this person ("your work will be ready on the 15th")."""

    __tablename__ = "wa_notes"

    id: Mapped[uuid.UUID] = _id()
    contact_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("wa_contacts.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WaTask(Base):
    __tablename__ = "wa_tasks"

    id: Mapped[uuid.UUID] = _id()
    contact_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("wa_contacts.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # manual | ai
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InboxDevice(Base):
    """A phone that feeds the inbox. Only the SHA-256 of its token is stored; revoking cuts it off at once."""

    __tablename__ = "inbox_devices"

    id: Mapped[uuid.UUID] = _id()
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    app_version: Mapped[str | None] = mapped_column(String(20))
    paired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta: Mapped[dict | None] = mapped_column(JSON)


class InboxPairCode(Base):
    __tablename__ = "inbox_pair_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InboxCommand(Base):
    """kind: sms | draft. status: pending | done | failed."""

    __tablename__ = "inbox_commands"

    id: Mapped[uuid.UUID] = _id()
    device_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("inbox_devices.id", ondelete="CASCADE"))
    msg_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    target: Mapped[str] = mapped_column(String(80), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
