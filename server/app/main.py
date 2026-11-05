"""Sumon VA backend (own server, own database). Phone-app API only."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.monitoring import init_sentry

init_sentry()
from app.core.ops_events import install_error_capture  # noqa: E402

install_error_capture()
from app.api.v1.router import api_router  # noqa: E402
from app.core.admin_safety import protect_assistant_audit_logs  # noqa: E402
from app.core.bootstrap import bootstrap_admin  # noqa: E402
from app.core.exceptions import ABOException  # noqa: E402

logger = logging.getLogger(__name__)

# Android app identity for passkeys (Digital Asset Links). Release + debug signing certificates.
_APP_PACKAGE = "com.masumon.sumonva"
_APP_CERT_SHA256 = (
    "56:09:5F:0F:AC:72:F8:F1:DC:CB:EB:70:62:C3:EE:00:5E:A5:1B:69:80:F6:A2:B6:89:F3:53:A6:DF:96:38:BA",  # release
    "B0:79:7D:14:84:38:30:83:AB:D3:05:B4:65:4B:C6:06:CB:F6:41:F5:5A:FD:D0:41:F6:59:3D:18:32:5D:B3:92",  # debug
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s", settings.APP_NAME)
    if settings.STARTUP_BOOTSTRAP_ENABLED:
        await bootstrap_admin()
    # Narrow, additive safety net only (tables themselves come from manual_sql/0001_sumon_va_schema.sql).
    from app.core.database import engine as _engine
    from app.core.schema_guard import ensure_admin_security_columns, ensure_wa_tables

    await ensure_admin_security_columns(_engine)
    await ensure_wa_tables(_engine)
    from app.core import scheduler

    job = scheduler.start() if settings.APP_ENV == "production" else None  # tests never start it
    yield
    if job:
        job.cancel()
    logger.info("Shutting down %s", settings.APP_NAME)


app = FastAPI(
    title=settings.APP_NAME, version="1.0.0", description="Sumon VA backend",
    docs_url="/docs" if settings.DEBUG else None, redoc_url=None,
    openapi_url="/openapi.json" if settings.DEBUG else None, lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["*"])
app.include_router(api_router)
from app.api.v1.routes.health import router as health_router  # noqa: E402

app.include_router(health_router)
app.middleware("http")(protect_assistant_audit_logs)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if request.headers.get("x-forwarded-proto", request.url.scheme) == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.exception_handler(ABOException)
async def abo_exception_handler(request: Request, exc: ABOException):
    return JSONResponse(status_code=exc.status_code, content={
        "success": False, "message": exc.message, "error_code": exc.error_code, "details": exc.details or None})


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s", exc, exc_info=exc)
    return JSONResponse(status_code=500, content={
        "success": False, "message": "Internal server error" if not settings.DEBUG else str(exc),
        "error_code": "INTERNAL_SERVER_ERROR", "details": None})


@app.get("/", include_in_schema=False)
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "status": "ok"}


@app.get("/.well-known/assetlinks.json", include_in_schema=False)
async def assetlinks():
    """Lets the Android app use passkeys bound to this host. Must be served directly (no redirect)."""
    return JSONResponse(
        content=[{"relation": ["delegate_permission/common.get_login_creds"],
                  "target": {"namespace": "android_app", "package_name": _APP_PACKAGE,
                             "sha256_cert_fingerprints": list(_APP_CERT_SHA256)}}],
        headers={"Cache-Control": "public, max-age=300"})
