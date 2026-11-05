"""Passkeys — sign in with fingerprint / face / phone screen lock (WebAuthn).

Admins and customers can add a passkey after a normal sign-in, then sign in with
one touch. Password + 2FA (admins) and e-mail code (customers) stay as fallback.

Challenges are stateless: each options call returns a short-lived signed token
holding the challenge, which the verify call must send back (works with any
number of workers and across restarts). Only the public key is stored.
"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.core.security import create_access_token, create_customer_token, require_admin, require_customer
from app.models.models import AdminUser, Passkey
from app.schemas.schemas import ApiResponse

router = APIRouter(prefix="/passkeys", tags=["passkeys"])

_CHALLENGE_MINUTES = 5


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _rp(request: Request) -> tuple[str, list[str]]:
    """Relying-party id + allowed origins. Production: aboenterprise.com (covers
    www.); local development: localhost."""
    origin = request.headers.get("origin") or settings.FRONTEND_URL
    host = (urlparse(origin).hostname or "").lower()
    if host in ("localhost", "127.0.0.1"):
        return "localhost", [origin]
    front = urlparse(settings.FRONTEND_URL).hostname or "www.aboenterprise.com"
    rp_id = front[4:] if front.startswith("www.") else front
    origins = [f"https://{rp_id}", f"https://www.{rp_id}"]
    admin = settings.admin_base_url
    if admin and admin not in origins:
        origins.append(admin)  # separate admin site; rp_id stays the registrable domain so existing passkeys still match
    personal = settings.personal_base_url
    if personal and personal not in origins:
        origins.append(personal)  # personal site (sumon.…): same rp_id, so the passkeys already registered keep working
    return rp_id, origins


def _challenge_token(challenge: bytes, purpose: str, owner: str = "") -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=_CHALLENGE_MINUTES)
    return jwt.encode({"c": _b64u(challenge), "p": purpose, "o": owner, "exp": exp, "type": "passkey"},
                      settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _read_challenge(token: str, purpose: str, owner: str = "") -> bytes:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="সময় শেষ — আবার চেষ্টা করুন।")
    if data.get("type") != "passkey" or data.get("p") != purpose or data.get("o", "") != owner:
        raise HTTPException(status_code=400, detail="অনুরোধটি সঠিক নয় — আবার চেষ্টা করুন।")
    return _unb64u(data["c"])


async def _owner_passkeys(db: AsyncSession, owner_type: str, owner_ref: str) -> list[Passkey]:
    return list((await db.execute(select(Passkey).where(
        Passkey.owner_type == owner_type, Passkey.owner_ref == owner_ref, Passkey.is_deleted == False  # noqa: E712
    ).order_by(Passkey.created_at.desc()))).scalars().all())


def _public(p: Passkey) -> dict:
    return {"id": str(p.id), "name": p.name or "পাসকি", "created_at": p.created_at.isoformat() if p.created_at else None,
            "last_used_at": p.last_used_at.isoformat() if p.last_used_at else None}


# ── Registration (signed-in user adds this device) ──────────────────────────
class RegisterVerifyIn(BaseModel):
    token: str = Field(..., max_length=2000)
    credential: dict
    name: str = Field("", max_length=120)


async def _register_options(request: Request | None, db: AsyncSession, owner_type: str, owner_ref: str, user_name: str, display: str,
                            *, rp_id: str | None = None, purpose: str = "register") -> dict:
    from webauthn import generate_registration_options, options_to_json
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement, UserVerificationRequirement,
    )
    import json

    if rp_id is None:
        rp_id, _ = _rp(request)
    existing = await _owner_passkeys(db, owner_type, owner_ref)
    opts = generate_registration_options(
        rp_id=rp_id,
        rp_name="ABO Enterprise",
        user_id=f"{owner_type}:{owner_ref}".encode()[:64],
        user_name=user_name[:64],
        user_display_name=display[:64],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=_unb64u(p.credential_id)) for p in existing],
        timeout=120000,
    )
    return {"options": json.loads(options_to_json(opts)), "token": _challenge_token(opts.challenge, purpose, f"{owner_type}:{owner_ref}")}


async def _register_verify(request: Request | None, db: AsyncSession, owner_type: str, owner_ref: str, payload: RegisterVerifyIn,
                           *, rp_id: str | None = None, origins: list[str] | None = None, purpose: str = "register") -> dict:
    from webauthn import verify_registration_response

    if rp_id is None or origins is None:
        rp_id, origins = _rp(request)
    challenge = _read_challenge(payload.token, purpose, f"{owner_type}:{owner_ref}")
    try:
        v = verify_registration_response(credential=payload.credential, expected_challenge=challenge,
                                         expected_rp_id=rp_id, expected_origin=origins, require_user_verification=True)
    except Exception as exc:  # noqa: BLE001 — any verification failure
        raise HTTPException(status_code=400, detail=f"এই ডিভাইস যোগ করা যায়নি ({type(exc).__name__})।")
    cred_id = _b64u(v.credential_id)
    if (await db.execute(select(Passkey).where(Passkey.credential_id == cred_id))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="এই পাসকি আগেই যোগ করা আছে।")
    transports = (payload.credential.get("response") or {}).get("transports") or []
    pk = Passkey(owner_type=owner_type, owner_ref=owner_ref, credential_id=cred_id, public_key=_b64u(v.credential_public_key),
                 sign_count=v.sign_count, transports=[str(t) for t in transports][:8], name=(payload.name or "").strip()[:120] or None)
    db.add(pk)
    await db.commit()
    return _public(pk)


@router.post("/admin/register/options", response_model=ApiResponse)
async def admin_register_options(request: Request, admin_id: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(AdminUser).where(AdminUser.id == uuid.UUID(admin_id)))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Admin not found")
    return ApiResponse(data=await _register_options(request, db, "admin", admin_id, user.email, user.name or user.email))


@router.post("/admin/register/verify", response_model=ApiResponse)
async def admin_register_verify(request: Request, payload: RegisterVerifyIn, admin_id: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return ApiResponse(data=await _register_verify(request, db, "admin", admin_id, payload), message="Passkey added")


@router.get("/admin", response_model=ApiResponse)
async def admin_list(admin_id: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return ApiResponse(data=[_public(p) for p in await _owner_passkeys(db, "admin", admin_id)])


@router.delete("/admin/{passkey_id}", response_model=ApiResponse)
async def admin_delete(passkey_id: uuid.UUID, admin_id: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    p = (await db.execute(select(Passkey).where(Passkey.id == passkey_id, Passkey.owner_type == "admin",
                                                Passkey.owner_ref == admin_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    p.is_deleted = True
    await db.commit()
    return ApiResponse(message="Passkey removed")


@router.post("/customer/register/options", response_model=ApiResponse)
async def customer_register_options(request: Request, customer: str = Depends(require_customer), db: AsyncSession = Depends(get_db)):
    return ApiResponse(data=await _register_options(request, db, "customer", customer, customer, customer))


@router.post("/customer/register/verify", response_model=ApiResponse)
async def customer_register_verify(request: Request, payload: RegisterVerifyIn, customer: str = Depends(require_customer), db: AsyncSession = Depends(get_db)):
    return ApiResponse(data=await _register_verify(request, db, "customer", customer, payload), message="Passkey added")


# ── Sign in with a passkey ───────────────────────────────────────────────────
class LoginVerifyIn(BaseModel):
    token: str = Field(..., max_length=2000)
    credential: dict


def _login_options(rp_id: str, purpose: str) -> dict:
    """Discoverable-credential sign-in options for one relying party + the signed challenge token."""
    import json

    from webauthn import generate_authentication_options, options_to_json
    from webauthn.helpers.structs import UserVerificationRequirement

    opts = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED, timeout=120000)
    return {"options": json.loads(options_to_json(opts)), "token": _challenge_token(opts.challenge, purpose)}


async def _login_verify(db: AsyncSession, token: str, credential: dict, purpose: str, owner_type: str, rp_id: str, origins: list[str]) -> Passkey:
    """Check a sign-in assertion; returns the matching Passkey (counter + last_used updated, not committed). 401 on any failure."""
    from webauthn import verify_authentication_response

    challenge = _read_challenge(token, purpose)
    cred_id = str(credential.get("id") or "")
    pk = (await db.execute(select(Passkey).where(Passkey.credential_id == cred_id, Passkey.owner_type == owner_type,
                                                 Passkey.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    if not pk:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="এই পাসকি চেনা যায়নি — পাসওয়ার্ড/কোড দিয়ে ঢুকে আবার যোগ করুন।")
    try:
        v = verify_authentication_response(credential=credential, expected_challenge=challenge, expected_rp_id=rp_id,
                                           expected_origin=origins, credential_public_key=_unb64u(pk.public_key),
                                           credential_current_sign_count=int(pk.sign_count or 0), require_user_verification=True)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="আঙুলের ছাপ/পাসকি যাচাই হয়নি — আবার চেষ্টা করুন।")
    pk.sign_count = v.new_sign_count
    pk.last_used_at = datetime.now(timezone.utc)
    return pk


@router.post("/login/options", response_model=ApiResponse, dependencies=[Depends(rate_limit("passkey_opts", 30, 600))])
async def login_options(request: Request, kind: str = "admin"):
    if kind not in ("admin", "customer"):
        raise HTTPException(status_code=400, detail="bad kind")
    rp_id, _ = _rp(request)
    return ApiResponse(data=_login_options(rp_id, f"login:{kind}"))


@router.post("/login/verify", response_model=ApiResponse, dependencies=[Depends(rate_limit("passkey_login", 30, 600))])
async def login_verify(request: Request, response: Response, payload: LoginVerifyIn, kind: str = "admin", db: AsyncSession = Depends(get_db)):
    if kind not in ("admin", "customer"):
        raise HTTPException(status_code=400, detail="bad kind")
    rp_id, origins = _rp(request)
    pk = await _login_verify(db, payload.token, payload.credential, f"login:{kind}", kind, rp_id, origins)

    if kind == "customer":
        await db.commit()
        return ApiResponse(data={"verified": True, "phone": pk.owner_ref, "access_token": create_customer_token(pk.owner_ref)}, message="Signed in")

    user = (await db.execute(select(AdminUser).where(AdminUser.id == uuid.UUID(pk.owner_ref), AdminUser.is_active == True))).scalar_one_or_none()  # noqa: E712
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="এই অ্যাকাউন্ট সক্রিয় নেই।")
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login = datetime.now(timezone.utc)
    token = create_access_token(str(user.id), extra={"tv": int(user.token_version or 0)})
    await db.commit()
    from app.api.v1.routes.auth import _set_session_cookie

    _set_session_cookie(request, response, token)
    return ApiResponse(data={"access_token": token, "mfa_setup_required": False}, message="Login successful")
