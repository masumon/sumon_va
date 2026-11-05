from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from time import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import (
    LOCK_MINUTES,
    MFA_SETUP_TOKEN_MINUTES,
    POLICY_KEY,
    consume_recovery_code,
    generate_recovery_codes,
    hash_recovery_codes,
    is_locked,
    looks_like_recovery_code,
    next_failure_state,
    recovery_codes_remaining,
    set_policy_cache,
    two_factor_required,
    verify_totp_once,
)
from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.core.database import get_db
from app.core.security import ADMIN_SESSION_COOKIE, create_access_token, require_admin, verify_password
from app.core.totp_crypto import encrypt_totp_secret, decrypt_totp_secret
from app.models.models import ActivityLog, AdminUser, Setting
from app.schemas.schemas import ApiResponse, LoginRequest, SecurityPolicyPayload, TokenResponse, TotpCodePayload

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory brute-force tracker — suitable for single-worker free-tier deployment.
# Keyed by client IP; stores timestamps of recent failed attempts.
_MAX_FAILURES = 5
_LOCKOUT_SECONDS = 300  # 5 minutes

_login_failures: dict[str, deque] = defaultdict(lambda: deque(maxlen=_MAX_FAILURES))


def _client_ip(request: Request) -> str:
    # One source of truth (Cloudflare-aware) for login lockouts and rate limits.
    from app.core.rate_limit import client_ip

    return client_ip(request)


def _is_locked(ip: str) -> bool:
    now = time()
    recent = [t for t in _login_failures[ip] if now - t < _LOCKOUT_SECONDS]
    _login_failures[ip] = deque(recent, maxlen=_MAX_FAILURES)
    return len(recent) >= _MAX_FAILURES


def _record_failure(ip: str) -> None:
    _login_failures[ip].append(time())


def _clear_failures(ip: str) -> None:
    _login_failures.pop(ip, None)


def _is_https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


async def _load_user(db: AsyncSession, admin_id: str) -> AdminUser:
    user = (await db.execute(select(AdminUser).where(AdminUser.id == UUID(admin_id)))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _register_account_failure(db: AsyncSession, user: AdminUser) -> None:
    """Count a failed sign-in on the account itself; lock it after repeated failures."""
    user.failed_login_count, user.locked_until = next_failure_state(user.failed_login_count)
    await db.commit()


def _set_session_cookie(request: Request, response: Response, token: str, minutes: int | None = None) -> None:
    response.set_cookie(
        ADMIN_SESSION_COOKIE,
        token,
        max_age=(minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60,
        httponly=True,
        secure=_is_https(request),
        samesite="lax",
        path="/",
    )


@router.post("/login", response_model=ApiResponse, dependencies=[Depends(rate_limit("auth_login", 40, 600))])
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    ip = _client_ip(request)

    if _is_locked(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {_LOCKOUT_SECONDS // 60} minutes.",
        )

    result = await db.execute(
        select(AdminUser).where(AdminUser.email == payload.email, AdminUser.is_active == True)  # noqa: E712
    )
    user = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    # Per-account lock (stored in the database, so it survives restarts and cannot be
    # dodged by changing IP address).
    if user and is_locked(user.locked_until, now):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"This account is temporarily locked after repeated failed attempts. Try again in {LOCK_MINUTES} minutes.",
        )

    if not user or not verify_password(payload.password, user.password_hash):
        _record_failure(ip)
        from app.core.ops_events import record_failed_login
        record_failed_login(ip, payload.email)
        if user:
            await _register_account_failure(db, user)
        if _is_locked(ip):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Try again in {_LOCKOUT_SECONDS // 60} minutes.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Second factor — only for accounts that enabled it. Accepts the 6-digit app code
    # (each code works once) or a one-time recovery code.
    used_recovery = False
    if user.totp_enabled and user.totp_secret:
        if not payload.totp_code:
            # Password verified; the client should now prompt for the code.
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="totp_required")
        code = payload.totp_code.strip()
        ok = False
        if looks_like_recovery_code(code):
            ok, new_codes = consume_recovery_code(user.totp_recovery_codes, code)
            if ok:
                user.totp_recovery_codes = new_codes
                used_recovery = True
        else:
            step = verify_totp_once(decrypt_totp_secret(user.totp_secret), code, user.totp_last_step)
            if step is not None:
                user.totp_last_step = step
                ok = True
        if not ok:
            _record_failure(ip)
            await _register_account_failure(db, user)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authenticator code")

    _clear_failures(ip)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login = now

    # Owner requires 2FA but this account has none yet: short session that can only
    # open the 2FA set-up screen (so nobody gets locked out, and nobody skips it).
    mfa_setup = (not user.totp_enabled) and await two_factor_required(db)
    token = create_access_token(
        str(user.id),
        expires_delta=timedelta(minutes=MFA_SETUP_TOKEN_MINUTES) if mfa_setup else None,
        extra={"tv": int(user.token_version or 0), **({"mfa_setup": True} if mfa_setup else {})},
    )
    remaining = recovery_codes_remaining(user.totp_recovery_codes) if user.totp_enabled else None
    await db.commit()
    # HttpOnly session cookie (XSS-safe). Host-only on the API domain —
    # same-site XHR from the frontend (www.aboenterprise.com ->
    # api.aboenterprise.com) sends it with credentials. The body token stays
    # for backward compatibility and non-browser clients.
    _set_session_cookie(request, response, token, minutes=MFA_SETUP_TOKEN_MINUTES if mfa_setup else None)
    return ApiResponse(
        data=TokenResponse(
            access_token=token,
            mfa_setup_required=mfa_setup,
            recovery_code_used=used_recovery,
            recovery_codes_remaining=remaining,
        ),
        message="Login successful",
    )


@router.post("/logout", response_model=ApiResponse)
async def logout(response: Response):
    """Clear the HttpOnly admin session cookie."""
    response.delete_cookie(ADMIN_SESSION_COOKIE, path="/")
    return ApiResponse(data=None, message="Logged out")


@router.post("/logout-all", response_model=ApiResponse)
async def logout_all(
    response: Response,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Sign this account out of every device (including this one)."""
    user = await _load_user(db, admin_id)
    user.token_version = int(user.token_version or 0) + 1
    await db.commit()
    response.delete_cookie(ADMIN_SESSION_COOKIE, path="/")
    return ApiResponse(data=None, message="Signed out from all devices")


def _totp_qr_data_uri(uri: str) -> str:
    """Provisioning URI → PNG QR code as a data URI (rendered client-side)."""
    import base64
    from io import BytesIO

    import qrcode

    img = qrcode.make(uri, box_size=6, border=2)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@router.get("/2fa/status", response_model=ApiResponse)
async def totp_status(
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, admin_id)
    return ApiResponse(
        data={
            "enabled": bool(user.totp_enabled),
            "recovery_codes_remaining": recovery_codes_remaining(user.totp_recovery_codes) if user.totp_enabled else 0,
            "required": await two_factor_required(db),
        }
    )


@router.post("/2fa/setup", response_model=ApiResponse)
async def totp_setup(
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate (or regenerate) a TOTP secret — NOT enabled until verified."""
    import pyotp

    user = await _load_user(db, admin_id)
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled. Disable it first.")
    secret = pyotp.random_base32()
    user.totp_secret = encrypt_totp_secret(secret)
    await db.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="ABO Enterprise Admin")
    return ApiResponse(data={"secret": secret, "otpauth_uri": uri, "qr_data_uri": _totp_qr_data_uri(uri)})


@router.post("/2fa/enable", response_model=ApiResponse)
async def totp_enable(
    request: Request,
    response: Response,
    payload: TotpCodePayload,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Confirm the authenticator app works, then turn 2FA on and issue recovery codes."""
    user = await _load_user(db, admin_id)
    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="Run 2FA setup first")
    step = verify_totp_once(decrypt_totp_secret(user.totp_secret), payload.code, user.totp_last_step)
    if step is None:
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    codes = generate_recovery_codes()
    user.totp_enabled = True
    user.totp_last_step = step
    user.totp_recovery_codes = hash_recovery_codes(codes)
    await db.commit()
    # A set-up-only session becomes a normal full session now.
    token = create_access_token(str(user.id), extra={"tv": int(user.token_version or 0)})
    _set_session_cookie(request, response, token)
    return ApiResponse(
        data={"enabled": True, "recovery_codes": codes, "access_token": token},
        message="Two-factor authentication enabled",
    )


@router.post("/2fa/recovery-codes", response_model=ApiResponse)
async def totp_regenerate_recovery_codes(
    payload: TotpCodePayload,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Replace the recovery codes with a fresh set (needs a current app code)."""
    user = await _load_user(db, admin_id)
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    step = verify_totp_once(decrypt_totp_secret(user.totp_secret), payload.code, user.totp_last_step)
    if step is None:
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    codes = generate_recovery_codes()
    user.totp_last_step = step
    user.totp_recovery_codes = hash_recovery_codes(codes)
    await db.commit()
    return ApiResponse(data={"recovery_codes": codes}, message="New recovery codes created")


@router.post("/2fa/disable", response_model=ApiResponse)
async def totp_disable(
    payload: TotpCodePayload,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Disabling requires a valid current code (protects a hijacked session)."""
    user = await _load_user(db, admin_id)
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    if await two_factor_required(db):
        raise HTTPException(
            status_code=400,
            detail="Two-factor authentication is required for all admins by the site owner, so it cannot be turned off.",
        )
    step = verify_totp_once(decrypt_totp_secret(user.totp_secret), payload.code, user.totp_last_step)
    if step is None:
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_recovery_codes = None
    user.totp_last_step = None
    await db.commit()
    return ApiResponse(data={"enabled": False}, message="Two-factor authentication disabled")


@router.get("/me", response_model=ApiResponse)
async def get_me(
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await _load_user(db, admin_id)
    return ApiResponse(
        data={
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "totp_enabled": bool(user.totp_enabled),
        }
    )


# ---------------------------------------------------------------- owner controls
async def _require_super_admin(db: AsyncSession, admin_id: str) -> AdminUser:
    user = await _load_user(db, admin_id)
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only the master (super) admin can do this")
    return user


@router.get("/security-policy", response_model=ApiResponse)
async def get_security_policy(
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Master admin: is 2FA required for everyone, and who has already set it up?"""
    me = await _require_super_admin(db, admin_id)
    admins = (
        await db.execute(select(AdminUser).where(AdminUser.is_active == True).order_by(AdminUser.created_at))  # noqa: E712
    ).scalars().all()
    return ApiResponse(
        data={
            "require_2fa": await two_factor_required(db),
            "my_totp_enabled": bool(me.totp_enabled),
            "admins": [
                {"id": str(a.id), "name": a.name, "email": a.email, "role": a.role, "totp_enabled": bool(a.totp_enabled)}
                for a in admins
            ],
        }
    )


@router.put("/security-policy", response_model=ApiResponse)
async def set_security_policy(
    payload: SecurityPolicyPayload,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Master admin: require (or stop requiring) 2FA for every admin account."""
    me = await _require_super_admin(db, admin_id)
    if payload.require_2fa and not me.totp_enabled:
        raise HTTPException(
            status_code=400,
            detail="Turn on two-factor authentication for your own account first, then require it for everyone.",
        )
    row = (await db.execute(select(Setting).where(Setting.key == POLICY_KEY))).scalar_one_or_none()
    value = "true" if payload.require_2fa else "false"
    if row:
        row.value = value
        row.is_deleted = False
    else:
        db.add(Setting(key=POLICY_KEY, value=value, data_type="boolean", description="Require 2FA for all admin accounts"))
    db.add(ActivityLog(
        admin_id=UUID(admin_id), action="update", entity_type="security_policy",
        new_values={"require_2fa": payload.require_2fa},
    ))
    await db.commit()
    set_policy_cache(payload.require_2fa)
    return ApiResponse(
        data={"require_2fa": payload.require_2fa},
        message="Two-factor authentication is now required for all admins" if payload.require_2fa else "Two-factor authentication is now optional",
    )


@router.post("/admins/{user_id}/reset-2fa", response_model=ApiResponse)
async def reset_admin_2fa(
    user_id: UUID,
    admin_id: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Master admin: help a colleague who lost their phone *and* recovery codes.

    Clears their authenticator and signs them out everywhere; at next sign-in they set
    up a new one (immediately, if 2FA is required)."""
    await _require_super_admin(db, admin_id)
    if str(user_id) == admin_id:
        raise HTTPException(status_code=400, detail="Use the Disable option for your own account")
    target = (await db.execute(select(AdminUser).where(AdminUser.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.totp_enabled = False
    target.totp_secret = None
    target.totp_recovery_codes = None
    target.totp_last_step = None
    target.token_version = int(target.token_version or 0) + 1
    target.failed_login_count = 0
    target.locked_until = None
    db.add(ActivityLog(
        admin_id=UUID(admin_id), action="update", entity_type="admin_user", entity_id=target.id,
        new_values={"action": "reset_2fa"},
    ))
    await db.commit()
    return ApiResponse(data=None, message="Two-factor authentication reset; they must sign in again")
