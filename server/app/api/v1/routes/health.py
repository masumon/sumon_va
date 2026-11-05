from fastapi import APIRouter
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from datetime import datetime, timezone

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "Sumon VA API",
        "version": "1.0.0",
    }


@router.get("/health/db")
async def db_health():
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception:
        import logging
        logging.getLogger(__name__).exception("DB health check failed")
        return {"status": "error", "database": "unavailable"}


@router.get("/health/ready")
async def readiness():
    """Kubernetes-style readiness probe."""
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {"ready": True}
    except Exception:
        from fastapi import status
        from fastapi.responses import JSONResponse
        return JSONResponse({"ready": False}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
