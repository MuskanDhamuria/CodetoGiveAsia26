"""Composition point for all version-one feature routers."""

from fastapi import APIRouter

from backend.api.routes import (
    ai_assistant,
    beneficiaries,
    event_templates,
    events,
    dashboard,
    health,
    inventory,
    logistics,
    organizations,
    participants,
    public,
    reports,
    team_members,
    volunteers,
    venues,
    volunteer_auth,
    whatsapp,
)


api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(beneficiaries.router)
api_router.include_router(event_templates.router)
api_router.include_router(events.router)
api_router.include_router(inventory.router)
api_router.include_router(logistics.router)
api_router.include_router(organizations.router)
api_router.include_router(venues.router)
api_router.include_router(team_members.router)
api_router.include_router(dashboard.router)
api_router.include_router(volunteers.router)
api_router.include_router(volunteer_auth.router)
api_router.include_router(participants.router)
api_router.include_router(public.router)
api_router.include_router(reports.router)
api_router.include_router(whatsapp.router)
api_router.include_router(ai_assistant.router)

# Add future feature routers here, for example:
# from backend.api.routes import event_templates
# api_router.include_router(event_templates.router)
