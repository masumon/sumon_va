from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.models import AssistantActionLog


class AssistantActionLogRetentionError(RuntimeError):
    """Raised when application code attempts to physically delete an audit log."""


@event.listens_for(Session, "before_flush")
def prevent_assistant_action_log_deletion(session, _flush_context, _instances):
    """Enforce audit-log retention at the ORM operation boundary.

    HTTP middleware protects the public DELETE route, but this guard is the
    authoritative safety boundary for every ORM path that attempts to delete
    an AssistantActionLog, including direct/internal route or service calls.
    """
    for obj in session.deleted:
        if isinstance(obj, AssistantActionLog):
            raise AssistantActionLogRetentionError("AUDIT_LOG_RETENTION")


async def protect_assistant_audit_logs(request: Request, call_next):
    """Audit logs are retained records; never permit destructive deletion."""
    path = request.url.path.rstrip("/")
    if request.method.upper() == "DELETE" and "/assistant/admin/logs/" in path:
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "message": "Assistant automation logs are retained for audit history and cannot be deleted.",
                "error_code": "AUDIT_LOG_RETENTION",
            },
        )
    return await call_next(request)
