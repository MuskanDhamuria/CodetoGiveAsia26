"""Composition point for all version-one feature routers."""

from fastapi import APIRouter

from backend.api.routes import events, health, participants, public


api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(events.router)
api_router.include_router(participants.router)
api_router.include_router(public.router)

# Add future feature routers here, for example:
# from backend.api.routes import event_templates
# api_router.include_router(event_templates.router)
