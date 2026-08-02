"""Tool executors — thin wrappers around the existing event route handlers.

Each function here takes an already-schema-validated argument model (see
`backend.ai_tools.schemas`) and a `sqlite3.Connection`, and calls straight
into `backend.api.routes.events`'s handler functions in-process. No SQL, no
business logic lives here — see TICKET-2 in docs/tickets.md for why.
"""

from __future__ import annotations

import sqlite3

from backend.api.routes import event_templates as event_templates_routes
from backend.api.routes import events as events_routes
from backend.api.routes import volunteers as volunteers_routes
from backend.api.routes._common import Pagination
from backend.ai_tools.schemas import (
    CancelEventArgs,
    CreateEventDraftArgs,
    GetEventArgs,
    ListEventsArgs,
    ListEventTemplatesArgs,
    ListVolunteersArgs,
    PublishEventArgs,
    UpdateEventArgs,
)
from backend.schema.events import EventCreate, EventUpdate


def create_event_draft(db: sqlite3.Connection, args: CreateEventDraftArgs) -> dict:
    """Validate a proposed event and return it as a draft — no DB write."""

    payload = EventCreate(**args.model_dump())
    # Business validation: template must exist, defaults resolve, without
    # inserting anything — reuses the exact check `create_event` makes.
    events_routes.resolve_event_template_context(db, payload)
    return {"status": "draft", "event": payload.model_dump(mode="json")}


def publish_event(db: sqlite3.Connection, args: PublishEventArgs) -> dict:
    """Take an approved draft and create the real event."""

    payload = EventCreate(**args.model_dump())
    detail = events_routes.create_event(payload, db)
    return detail.model_dump(mode="json")


def update_event(db: sqlite3.Connection, args: UpdateEventArgs) -> dict:
    fields = args.model_dump(exclude={"event_id"}, exclude_unset=True)
    payload = EventUpdate(**fields)
    detail = events_routes.update_event(args.event_id, payload, db)
    return detail.model_dump(mode="json")


def get_event(db: sqlite3.Connection, args: GetEventArgs) -> dict:
    detail = events_routes.get_event(args.event_id, db)
    return detail.model_dump(mode="json")


def list_events(db: sqlite3.Connection, args: ListEventsArgs) -> dict:
    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = events_routes.list_events(
        db,
        pagination,
        status=args.status,
        date_from=args.date_from,
        date_to=args.date_to,
        template_id=args.template_id,
        beneficiary_id=args.beneficiary_id,
        q=args.q,
    )
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def cancel_event(db: sqlite3.Connection, args: CancelEventArgs) -> dict:
    detail = events_routes.cancel_event(args.event_id, db)
    return detail.model_dump(mode="json")


def list_event_templates(db: sqlite3.Connection, args: ListEventTemplatesArgs) -> dict:
    """Look up existing templates by name — lets the AI resolve a template

    the organizer named in conversation to its id, or confirm none fits and
    proceed with `event_template_id: null`, instead of asking the organizer
    for a raw id it has no way to know (TICKET-12).
    """

    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = event_templates_routes.list_templates(
        db, pagination, is_built_in=args.is_built_in, q=args.q
    )
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def list_volunteers(db: sqlite3.Connection, args: ListVolunteersArgs) -> dict:
    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = volunteers_routes.list_volunteers(
        db,
        pagination,
        signup_status=args.signup_status,
        skill_id=args.skill_id,
        role_id=args.role_id,
        q=args.q,
    )
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


TOOL_EXECUTORS = {
    "create_event_draft": create_event_draft,
    "publish_event": publish_event,
    "update_event": update_event,
    "get_event": get_event,
    "list_events": list_events,
    "cancel_event": cancel_event,
    "list_event_templates": list_event_templates,
    "list_volunteers": list_volunteers,
}
