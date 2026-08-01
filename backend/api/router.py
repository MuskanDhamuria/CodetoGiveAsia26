"""Composition point for all version-one feature routers."""

from fastapi import APIRouter

from backend.api.routes import (
    beneficiaries,
    event_templates,
    events,
    dashboard,
    health,
    participants,
    team_members,
    volunteers,
)


api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(beneficiaries.router)
api_router.include_router(event_templates.router)
api_router.include_router(events.router)
api_router.include_router(team_members.router)
api_router.include_router(dashboard.router)
api_router.include_router(volunteers.router)
api_router.include_router(participants.router)

# Add future feature routers here, for example:
# from backend.api.routes import event_templates, events
# api_router.include_router(event_templates.router)
# api_router.include_router(events.router)
