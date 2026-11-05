from fastapi import HTTPException, status

ROLE_PERMISSIONS = {
    "super_admin": ["*"],
    "admin": [
        "orders.read", "orders.write", "orders.delete",
        "products.read", "products.write", "products.delete",
        "services.read", "services.write", "services.delete",
        "bookings.read", "bookings.write", "bookings.delete",
        "leads.read", "leads.write",
        "customers.read", "customers.write",
        "analytics.read",
        "bulk.read", "bulk.write",
        "settings.read", "settings.write",
        "users.read", "users.write", "users.delete",
        "blog.read", "blog.write",
        "pages.read", "pages.write",
        "media.read", "media.write",
        "reviews.read", "reviews.write",
        "career.read", "career.write",
        "invoices.read", "invoices.write",
        "email_templates.read", "email_templates.write",
        "email.send",
        "ops.read", "ops.write",
        "payments.read", "payments.write",
        "audit_logs.read",
        "app.read", "app.write",
    ],
    "editor": [
        "orders.read", "products.read", "products.write",
        "services.read", "services.write",
        "bookings.read", "bookings.write",
        "leads.read", "analytics.read",
        "blog.read", "blog.write",
        "pages.read", "pages.write",
        "media.read", "media.write",
        "reviews.read", "reviews.write",
    ],
    "viewer": [
        "orders.read", "products.read", "services.read",
        "bookings.read", "leads.read", "analytics.read",
        "blog.read", "pages.read", "media.read", "reviews.read",
    ],
}


def has_permission(role: str, permission: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, [])
    return "*" in perms or permission in perms


def check_role(user_role: str, required_permission: str):
    if not has_permission(user_role, required_permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: {required_permission} required"
        )
