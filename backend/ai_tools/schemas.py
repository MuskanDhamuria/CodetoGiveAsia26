"""Argument schemas for AI tool calls.

These subclass or reuse the same Pydantic models `backend/schema/events.py`
already defines for the human-driven HTTP routes, per TICKET-3's "schema
validation" stage — the AI path must validate against the exact same rules,
not a hand-rolled parallel schema that could drift from them.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.api.routes._common import DEFAULT_LIMIT, MAX_LIMIT
from backend.schema.common import TaskCategory, TaskStatus
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


class ListEventTasksArgs(BaseModel):
    """TICKET-13: filtered task visibility for a single event."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    category: TaskCategory | None = None
    status: TaskStatus | None = None
    team_member_id: int | None = None
    due_before: date | None = None
    due_after: date | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class AssignEventTaskArgs(BaseModel):
    """TICKET-14: task assignment only ever targets a team member, never a

    volunteer — see the ticket's "scope correction" for why. `team_member_id`
    is required (not defaulted) so the model must always state its intent
    explicitly; pass null to unassign.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    task_id: int
    team_member_id: int | None


class UpdateTaskStatusArgs(BaseModel):
    """TICKET-15: one tool over the three status-transition handlers."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    task_id: int
    status: TaskStatus


class ListUpcomingDeadlinesArgs(BaseModel):
    """TICKET-17."""

    model_config = ConfigDict(extra="forbid")

    days: int = Field(default=14, ge=1, le=365)
    team_member_id: int | None = None
    limit: int = Field(default=20, ge=1, le=100)


class ListEventRolesArgs(BaseModel):
    """TICKET-19/23."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class ListEventSignupsArgs(BaseModel):
    """TICKET-19/23."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    status: str | None = None
    role_id: int | None = None
    attendance: bool | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class ListPendingSignupsArgs(BaseModel):
    """TICKET-37: same filters as ListEventSignupsArgs, minus event_id, so

    the AI can answer cross-event questions ("which volunteers haven't
    been approved?") without an organizer naming an event first.
    """

    model_config = ConfigDict(extra="forbid")

    status: str | None = None
    role_id: int | None = None
    attendance: bool | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class ListInventoryItemsArgs(BaseModel):
    """TICKET-39."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class ListInventoryLocationsArgs(BaseModel):
    """TICKET-39."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetStockLevelsArgs(BaseModel):
    """TICKET-39: no filters — mirrors GET /inventory/stock, which returns

    every item/location combination with on-hand stock in one unfiltered
    response.
    """

    model_config = ConfigDict(extra="forbid")


class ListInventoryMovementsArgs(BaseModel):
    """TICKET-39."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class PreviewAnnouncementArgs(BaseModel):
    """TICKET-40: no DB write — lets the organizer see the drafted message

    and recipient count before send_announcement actually dispatches it.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    audience: Literal["all", "participants", "volunteers"] = "all"


class SendAnnouncementArgs(BaseModel):
    """TICKET-40: only call after the organizer has explicitly confirmed a

    preview_announcement result — see SYSTEM_PROMPT in ai_assistant.py.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    audience: Literal["all", "participants", "volunteers"] = "all"


class PreviewShiftReminderArgs(BaseModel):
    """TICKET-40."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    body: str | None = None


class SendShiftReminderArgs(BaseModel):
    """TICKET-40: only call after the organizer has explicitly confirmed a

    preview_shift_reminder result — see SYSTEM_PROMPT in ai_assistant.py.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    body: str | None = None


class ListCompletedEventReportsArgs(BaseModel):
    """TICKET-41."""

    model_config = ConfigDict(extra="forbid")


class ListEventCertificatesArgs(BaseModel):
    """TICKET-41."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class PreviewCertificateGenerationArgs(BaseModel):
    """TICKET-41: no DB write — counts how many attendees/volunteers are

    eligible and how many already have a delivered certificate, before
    generate_event_certificates actually creates and messages them.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int


class GenerateEventCertificatesArgs(BaseModel):
    """TICKET-41: only call after the organizer has explicitly confirmed a

    preview_certificate_generation result — this messages real participants
    and volunteers on WhatsApp, see SYSTEM_PROMPT in ai_assistant.py.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int


class ApproveEventSignupArgs(BaseModel):
    """TICKET-19: only reached after the organizer explicitly confirms a

    recommendation — see SYSTEM_PROMPT in ai_assistant.py.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    signup_id: int
    assigned_role_id: int
    is_leader: bool = False


TOOL_ARG_MODELS: dict[str, type[BaseModel]] = {
    "create_event_draft": CreateEventDraftArgs,
    "publish_event": PublishEventArgs,
    "update_event": UpdateEventArgs,
    "get_event": GetEventArgs,
    "list_events": ListEventsArgs,
    "cancel_event": CancelEventArgs,
    "list_event_templates": ListEventTemplatesArgs,
    "list_volunteers": ListVolunteersArgs,
    "list_event_tasks": ListEventTasksArgs,
    "assign_event_task": AssignEventTaskArgs,
    "update_task_status": UpdateTaskStatusArgs,
    "list_upcoming_deadlines": ListUpcomingDeadlinesArgs,
    "list_event_roles": ListEventRolesArgs,
    "list_event_signups": ListEventSignupsArgs,
    "list_pending_signups": ListPendingSignupsArgs,
    "approve_event_signup": ApproveEventSignupArgs,
    "list_inventory_items": ListInventoryItemsArgs,
    "list_inventory_locations": ListInventoryLocationsArgs,
    "get_stock_levels": GetStockLevelsArgs,
    "list_inventory_movements": ListInventoryMovementsArgs,
    "preview_announcement": PreviewAnnouncementArgs,
    "send_announcement": SendAnnouncementArgs,
    "preview_shift_reminder": PreviewShiftReminderArgs,
    "send_shift_reminder": SendShiftReminderArgs,
    "list_completed_event_reports": ListCompletedEventReportsArgs,
    "list_event_certificates": ListEventCertificatesArgs,
    "preview_certificate_generation": PreviewCertificateGenerationArgs,
    "generate_event_certificates": GenerateEventCertificatesArgs,
}
