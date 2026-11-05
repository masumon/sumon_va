from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID
import bcrypt
from jose import JWTError, jwt
from fastapi import HTTPException, Request, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.core.database import get_db
from app.models.models import AdminUser

bearer_scheme = HTTPBearer(auto_error=False)

# HttpOnly session cookie for the admin panel. Set at login alongside the
# body token; require_admin accepts either, so old Bearer sessions keep
# working and the frontend can migrate without a breaking change.
ADMIN_SESSION_COOKIE = "abo_admin_session"


def hash_password(password: str) -> str:
    # cost=12 is the current OWASP baseline. Existing hashes at other costs
    # remain valid — bcrypt.checkpw reads the cost from each stored hash.
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
    extra: dict | None = None,
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return jwt.encode(
        {**(extra or {}), "sub": str(subject), "exp": expire, "type": "access"},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


CUSTOMER_TOKEN_DAYS = 30


def create_customer_token(phone: str) -> str:
    """Issued after OTP verification — proves ownership of a phone number."""
    expire = datetime.now(timezone.utc) + timedelta(days=CUSTOMER_TOKEN_DAYS)
    return jwt.encode(
        {"sub": phone, "exp": expire, "type": "customer"},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


# These routes historically used the coarse require_admin dependency even
# though their UI/API contracts are role-aware. Keep the route implementations
# unchanged while enforcing the intended least-privilege permission here.
# All other require_admin callers remain admin-only.
_LEGACY_ROUTE_PERMISSIONS = {
    ("GET", "/admin/stats"): "analytics.read",
    ("GET", "/admin/ai-catalog/status"): "products.read",
    ("GET", "/admin/analytics/today"): "analytics.read",
    ("GET", "/admin/analytics/overview"): "analytics.read",
    ("GET", "/admin/analytics/revenue-chart"): "analytics.read",
    ("GET", "/admin/analytics/lead-funnel"): "analytics.read",
    ("GET", "/admin/analytics/top-products"): "analytics.read",
    ("GET", "/admin/analytics/visitors"): "analytics.read",
    ("GET", "/admin/analytics/visitors/status"): "analytics.read",
    ("GET", "/admin/analytics/visitors/live"): "analytics.read",
    ("POST", "/admin/upload"): "media.write",
    ("GET", "/admin/users"): "users.read",
    ("GET", "/admin/audit-logs"): "audit_logs.read",
    ("GET", "/admin/audit-logs/meta"): "audit_logs.read",
    ("GET", "/combos/admin/all"): "products.read",
    ("GET", "/assistant/admin/config"): "ops.read",
    ("PUT", "/assistant/admin/config"): "ops.write",
    ("GET", "/assistant/admin/conversations"): "ops.read",
    ("GET", "/assistant/admin/logs"): "ops.read",
    ("GET", "/assistant/admin/faq"): "ops.read",
    ("POST", "/assistant/admin/faq"): "ops.write",
}


# Explicit self-service routes operate only on the authenticated admin's own
# account/resources. Endpoint code must continue enforcing ownership.
_ADMIN_SELF_SERVICE_ROUTES = {
    ("POST", "/auth/logout-all"),
    ("GET", "/auth/2fa/status"),
    ("POST", "/auth/2fa/setup"),
    ("POST", "/auth/2fa/enable"),
    ("POST", "/auth/2fa/recovery-codes"),
    ("POST", "/auth/2fa/disable"),
    ("GET", "/auth/me"),
    ("GET", "/admin/roles-permissions"),
    ("POST", "/passkeys/admin/register/options"),
    ("POST", "/passkeys/admin/register/verify"),
    ("GET", "/passkeys/admin"),
    ("GET", "/admin/notifications"),
    ("GET", "/admin/notifications/unread-count"),
    ("POST", "/admin/notifications/read-all"),
}

# These helpers only generate draft text/content and never persist it. Preserve
# editor access when the role has an existing write permission; viewers have
# read-only permissions and are denied.
_EDITOR_WRITE_UTILITY_ROUTES = {
    ("POST", "/admin/translate"),
    ("POST", "/admin/ai-catalog/describe"),
    ("POST", "/admin/ai-catalog/booking-fields"),
    ("POST", "/admin/ai-catalog/from-link"),
    ("POST", "/admin/ai-catalog/service-details"),
    ("POST", "/admin/ai-catalog/write"),
    ("POST", "/admin/ai-catalog/category-ideas"),
    ("POST", "/admin/ai-catalog/blog-draft"),
    ("POST", "/admin/ai-catalog/fill"),
}


def _normalized_route(request: Request) -> tuple[str, str]:
    """Return method and path with only the known API version prefix removed."""
    method = request.method.upper()
    path = request.url.path.rstrip("/") or "/"
    if path.startswith("/api/v1/"):
        path = path[len("/api/v1") :]
    return method, path


def _is_uuid_segment(value: str) -> bool:
    try:
        UUID(value)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _is_admin_self_service_route(method: str, path: str) -> bool:
    if (method, path) in _ADMIN_SELF_SERVICE_ROUTES:
        return True

    parts = path.split("/")
    # Notifications are filtered to broadcasts or the current admin's target
    # and mutation handlers repeat the same ownership filter.
    if (
        method == "POST"
        and len(parts) == 5
        and parts[1:3] == ["admin", "notifications"]
        and parts[4] == "read"
        and _is_uuid_segment(parts[3])
    ):
        return True
    if (
        method == "DELETE"
        and len(parts) == 4
        and parts[1:3] == ["admin", "notifications"]
        and _is_uuid_segment(parts[3])
    ):
        return True

    # Passkey deletion checks owner_type and owner_ref against the current
    # admin_id inside the route handler.
    if (
        method == "DELETE"
        and len(parts) == 4
        and parts[1:3] == ["passkeys", "admin"]
        and _is_uuid_segment(parts[3])
    ):
        return True
    return False


def _role_has_write_permission(role: str) -> bool:
    from app.core.rbac import ROLE_PERMISSIONS

    permissions = ROLE_PERMISSIONS.get(role, [])
    return "*" in permissions or any(permission.endswith(".write") for permission in permissions)


def _route_has_explicit_role_dependency(request: Request) -> bool:
    """Return whether this route declares a nested require_role dependency."""
    route = request.scope.get("route")
    root = getattr(route, "dependant", None)
    pending = [root] if root is not None else []
    visited: set[int] = set()
    while pending:
        dependency = pending.pop()
        if id(dependency) in visited:
            continue
        visited.add(id(dependency))
        call = getattr(dependency, "call", None)
        if getattr(call, "_abo_required_permission", None):
            return True
        pending.extend(getattr(dependency, "dependencies", ()) or ())
    return False

def _enforce_unmapped_admin_route_policy(request: Request, role: str) -> None:
    """Fail closed for legacy routes unless explicitly classified above."""
    method, path = _normalized_route(request)
    if role not in {"super_admin", "admin", "editor", "viewer"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unknown admin role")

    if _is_admin_self_service_route(method, path):
        return
    if (method, path) in _EDITOR_WRITE_UTILITY_ROUTES and _role_has_write_permission(role):
        return
    if role not in {"super_admin", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


def _legacy_route_permission(request: Request) -> str | None:
    method, path = _normalized_route(request)

    # Match only the intended route after removing the known API version
    # prefix. Suffix matching could accidentally assign a permission to an
    # unrelated protected route that happened to end with the same path.

    for (expected_method, expected_path), permission in _LEGACY_ROUTE_PERMISSIONS.items():
        if method == expected_method and path == expected_path:
            return permission

    # Assistant detail/update/delete endpoints contain resource identifiers.
    # Their prefix must begin at the normalized route root, not appear in an
    # arbitrary path segment.
    # UUID-typed resources are validated here as well as by FastAPI. This
    # keeps malformed paths from receiving a permission based only on a prefix.
    uuid_routes = (
        ("GET", "/assistant/admin/conversations/", "ops.read"),
        ("DELETE", "/assistant/admin/conversations/", "ops.write"),
        ("DELETE", "/assistant/admin/logs/", "ops.write"),
    )
    for expected_method, prefix, permission in uuid_routes:
        resource_id = path[len(prefix) :] if path.startswith(prefix) else ""
        if (
            method == expected_method
            and resource_id
            and "/" not in resource_id
            and _is_uuid_segment(resource_id)
        ):
            return permission

    # FAQ keys are slugs/strings rather than UUIDs; still require exactly one
    # non-empty path segment and the precise HTTP method.
    faq_routes = (
        ("PUT", "/assistant/admin/faq/", "ops.write"),
        ("DELETE", "/assistant/admin/faq/", "ops.write"),
    )
    for expected_method, prefix, permission in faq_routes:
        resource_id = path[len(prefix) :] if path.startswith(prefix) else ""
        if method == expected_method and resource_id and "/" not in resource_id:
            return permission
    return None


async def require_customer(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """Returns the OTP-verified phone number from a customer token."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phone verification required. Please log in with OTP.",
        )
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "customer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    phone = payload.get("sub")
    if not phone:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return phone


async def require_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> str:
    # Bearer header first (legacy sessions, API tools); HttpOnly session
    # cookie as fallback (XSS-safe browser sessions).
    token = credentials.credentials if credentials else request.cookies.get(ADMIN_SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    admin_id = payload.get("sub")
    if not admin_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        admin_uuid = UUID(admin_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == admin_uuid, AdminUser.is_active == True)  # noqa: E712
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin account inactive or not found")

    # Signed out everywhere ("log out all devices", password reset, 2FA reset): the
    # version baked into the token no longer matches. Tokens issued before this
    # feature carry no version and count as 0, so existing sessions stay valid.
    if int(payload.get("tv", 0) or 0) != int(user.token_version or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session ended. Please sign in again.")

    # When the owner requires 2FA, a session without it may only reach the 2FA set-up
    # endpoints — it can never be locked out, and never reach admin data.
    if not user.totp_enabled:
        from app.core.admin_security import path_allowed_before_2fa, two_factor_required

        if (payload.get("mfa_setup") or await two_factor_required(db)) and not path_allowed_before_2fa(request.url.path):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="2fa_setup_required")

    permission = _legacy_route_permission(request)
    if permission:
        from app.core.rbac import check_role
        check_role(user.role, permission)
    elif not _route_has_explicit_role_dependency(request):
        _enforce_unmapped_admin_route_policy(request, user.role)

    return admin_id


def require_role(permission: str):
    """FastAPI dependency factory — validates JWT and enforces RBAC permission.

    Usage: _admin: str = Depends(require_role("products.delete"))
    Resolves role from DB on every call so role changes take effect immediately.
    """
    from app.core.database import get_db
    from app.models.models import AdminUser
    from app.core.rbac import check_role

    async def _dependency(
        admin_id: str = Depends(require_admin),
        db: AsyncSession = Depends(get_db),
    ) -> str:
        result = await db.execute(
            select(AdminUser).where(AdminUser.id == UUID(admin_id), AdminUser.is_active == True)  # noqa: E712
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin account not found")
        check_role(user.role, permission)
        return admin_id

    setattr(_dependency, "_abo_required_permission", permission)
    return _dependency
