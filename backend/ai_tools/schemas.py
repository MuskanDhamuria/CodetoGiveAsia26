"""Argument schemas for AI tool calls.

These subclass or reuse the same Pydantic models `backend/schema/events.py`
already defines for the human-driven HTTP routes, per TICKET-3's "schema
validation" stage — the AI path must validate against the exact same rules,
not a hand-rolled parallel schema that could drift from them.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from backend.api.routes._common import DEFAULT_LIMIT, MAX_LIMIT
from backend.schema.events import EventCreate, EventUpdate


class CreateEventDraftArgs(EventCreate):
    """Same shape as a human-created event; nothing is written to the DB yet."""

    model_config = ConfigDict(extra="forbid")


class PublishEventArgs(EventCreate):
    """An approved draft, ready to become a real event via `create_event`."""

    model_config = ConfigDict(extra="forbid")


class UpdateEventArgs(EventUpdate):
    event_id: int

    model_config = ConfigDict(extra="forbid")


class GetEventArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: int


class ListEventsArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    template_id: int | None = None
    beneficiary_id: int | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class ListEventTemplatesArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_built_in: bool | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class CancelEventArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: int


class ListVolunteersArgs(BaseModel):
    """TICKET-16."""

    model_config = ConfigDict(extra="forbid")

    signup_status: str | None = None
    skill_id: int | None = None
    role_id: int | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


TOOL_ARG_MODELS: dict[str, type[BaseModel]] = {
    "create_event_draft": CreateEventDraftArgs,
    "publish_event": PublishEventArgs,
    "update_event": UpdateEventArgs,
    "get_event": GetEventArgs,
    "list_events": ListEventsArgs,
    "cancel_event": CancelEventArgs,
    "list_event_templates": ListEventTemplatesArgs,
    "list_volunteers": ListVolunteersArgs,
}
