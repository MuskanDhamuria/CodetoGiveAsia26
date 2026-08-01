"""Composition point for all version-one feature routers."""

from fastapi import APIRouter

from backend.api.routes import health


api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)

# Add future feature routers here, for example:
# from backend.api.routes import event_templates, events
# api_router.include_router(event_templates.router)
# api_router.include_router(events.router)
