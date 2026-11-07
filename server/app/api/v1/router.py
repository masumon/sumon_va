"""Sumon VA API: only the phone app's routes (no shop, payments or website chatbot)."""
from fastapi import APIRouter

from app.api.v1.routes import ai_hub, inbox, integration, wa_assistant

api_router = APIRouter(prefix="/api/v1")
# ai_catalog (ABO shop product/blog writer) is not mounted: this server has no shop tables (2026-11-07)
api_router.include_router(ai_hub.router)
api_router.include_router(wa_assistant.router)
api_router.include_router(inbox.router)
api_router.include_router(integration.router)
