"""Sumon VA API: only the phone app's routes (no shop, payments or website chatbot)."""
from fastapi import APIRouter

from app.api.v1.routes import ai_catalog, ai_hub, inbox, integration, wa_assistant

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(ai_catalog.router)
api_router.include_router(ai_hub.router)
api_router.include_router(wa_assistant.router)
api_router.include_router(inbox.router)
api_router.include_router(integration.router)
