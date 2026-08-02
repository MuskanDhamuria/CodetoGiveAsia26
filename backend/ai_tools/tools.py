"""Tool executors — thin wrappers around the existing event route handlers.

Each function here takes an already-schema-validated argument model (see
`backend.ai_tools.schemas`) and a `sqlite3.Connection`, and calls straight
into `backend.api.routes.events`'s handler functions in-process. No SQL, no
business logic lives here — see TICKET-2 in docs/tickets.md for why.
"""

from __future__ import annotations

import sqlite3

from backend.api.routes import dashboard as dashboard_routes
from backend.api.routes import event_templates as event_templates_routes
from backend.api.routes import events as events_routes
from backend.api.routes import inventory as inventory_routes
from backend.api.routes import reports as reports_routes
from backend.api.routes import volunteers as volunteers_routes
from backend.api.routes import whatsapp as whatsapp_routes
from backend.api.routes._common import Pagination
from backend.bot.commands import audience_contacts
from backend.ai_tools.schemas import (
    ApproveEventSignupArgs,
    AssignEventTaskArgs,
    CancelEventArgs,
    CreateEventDraftArgs,
    GenerateEventCertificatesArgs,
    GetEventArgs,
    GetStockLevelsArgs,
    ListCompletedEventReportsArgs,
    ListEventCertificatesArgs,
    ListEventRolesArgs,
    ListEventSignupsArgs,
    ListEventsArgs,
    ListEventTasksArgs,
    ListEventTemplatesArgs,
    ListInventoryItemsArgs,
    ListInventoryLocationsArgs,
    ListInventoryMovementsArgs,
    ListPendingSignupsArgs,
    ListUpcomingDeadlinesArgs,
    ListVolunteersArgs,
    PreviewAnnouncementArgs,
    PreviewCertificateGenerationArgs,
    PreviewShiftReminderArgs,
    PublishEventArgs,
    SendAnnouncementArgs,
    SendShiftReminderArgs,
    UpdateEventArgs,
    UpdateTaskStatusArgs,
)
from backend.schema.events import EventCreate, EventTaskUpdate, EventUpdate
from backend.schema.volunteers import SignupApprove
from backend.schema.whatsapp import AnnouncementCreate, ReminderCreate

_TASK_STATUS_HANDLERS = {
    "ongoing": events_routes.start_task,
    "done": events_routes.complete_task,
    "incomplete": events_routes.reopen_task,
}


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


def list_event_tasks(db: sqlite3.Connection, args: ListEventTasksArgs) -> dict:
    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = events_routes.list_event_tasks(
        args.event_id,
        db,
        pagination,
        category=args.category,
        task_status=args.status,
        team_member_id=args.team_member_id,
        due_before=args.due_before.isoformat() if args.due_before else None,
        due_after=args.due_after.isoformat() if args.due_after else None,
    )
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def assign_event_task(db: sqlite3.Connection, args: AssignEventTaskArgs) -> dict:
    """Assign (or, with `team_member_id: null`, unassign) a task — the

    active-member check lives in `update_event_task` itself, not duplicated
    here (TICKET-14).
    """

    payload = EventTaskUpdate(team_member_id=args.team_member_id)
    detail = events_routes.update_event_task(args.event_id, args.task_id, payload, db)
    return detail.model_dump(mode="json")


def update_task_status(db: sqlite3.Connection, args: UpdateTaskStatusArgs) -> dict:
    handler = _TASK_STATUS_HANDLERS[args.status]
    detail = handler(args.event_id, args.task_id, db)
    return detail.model_dump(mode="json")


def list_upcoming_deadlines(db: sqlite3.Connection, args: ListUpcomingDeadlinesArgs) -> dict:
    return dashboard_routes.upcoming_deadlines(
        db, days=args.days, team_member_id=args.team_member_id, limit=args.limit
    )


def list_event_roles(db: sqlite3.Connection, args: ListEventRolesArgs) -> dict:
    roles = volunteers_routes.list_event_roles(args.event_id, db)
    return {"items": [role.model_dump(mode="json") for role in roles]}


def list_event_signups(db: sqlite3.Connection, args: ListEventSignupsArgs) -> dict:
    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = volunteers_routes.list_event_signups(
        args.event_id,
        db,
        pagination,
        status=args.status,
        role_id=args.role_id,
        attendance=args.attendance,
        q=args.q,
    )
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def list_pending_signups(db: sqlite3.Connection, args: ListPendingSignupsArgs) -> dict:
    """TICKET-37: cross-event signups, for phrasings that name no event."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return volunteers_routes.list_signups_across_events(
        db,
        pagination,
        status=args.status,
        role_id=args.role_id,
        attendance=args.attendance,
        q=args.q,
    )


def approve_event_signup(db: sqlite3.Connection, args: ApproveEventSignupArgs) -> dict:
    """Only reached after the organizer explicitly confirms a recommendation

    (TICKET-19's SYSTEM_PROMPT guidance) — never auto-approve.
    """

    payload = SignupApprove(assigned_role_id=args.assigned_role_id, is_leader=args.is_leader)
    detail = volunteers_routes.approve_event_signup(args.event_id, args.signup_id, payload, db)
    return detail.model_dump(mode="json")


def list_inventory_items(db: sqlite3.Connection, args: ListInventoryItemsArgs) -> dict:
    """TICKET-39: read-only. Write tools (adjustments/transfers) are

    deliberately not wired up yet — see the ticket for why.
    """

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return inventory_routes.list_items(db, pagination)


def list_inventory_locations(db: sqlite3.Connection, args: ListInventoryLocationsArgs) -> dict:
    """TICKET-39."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return inventory_routes.list_locations(db, pagination)


def get_stock_levels(db: sqlite3.Connection, args: GetStockLevelsArgs) -> dict:
    """TICKET-39."""

    return inventory_routes.list_stock(db)


def list_inventory_movements(db: sqlite3.Connection, args: ListInventoryMovementsArgs) -> dict:
    """TICKET-39."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return inventory_routes.list_movements(db, pagination)


def preview_announcement(db: sqlite3.Connection, args: PreviewAnnouncementArgs) -> dict:
    """TICKET-40: no DB write. get_event's own 404 check doubles as the

    "does this event exist" business validation, same reuse pattern as the
    rest of this module.
    """

    events_routes.get_event(args.event_id, db)
    contacts = audience_contacts(db, args.event_id, args.audience)
    return {
        "event_id": args.event_id,
        "title": args.title,
        "body": args.body,
        "audience": args.audience,
        "recipient_count": len(contacts),
    }


def send_announcement(db: sqlite3.Connection, args: SendAnnouncementArgs) -> dict:
    """TICKET-40: only reached after the organizer explicitly confirms a

    preview_announcement result (SYSTEM_PROMPT guidance) — this sends real
    WhatsApp messages with no undo.
    """

    payload = AnnouncementCreate(title=args.title, body=args.body, audience=args.audience)
    detail = whatsapp_routes.create_announcement(args.event_id, payload, db)
    return detail.model_dump(mode="json")


def preview_shift_reminder(db: sqlite3.Connection, args: PreviewShiftReminderArgs) -> dict:
    """TICKET-40: no DB write. Shift reminders always target the

    'volunteers' audience, matching create_reminder's hardcoded value.
    """

    detail = events_routes.get_event(args.event_id, db)
    body = args.body or whatsapp_routes.default_reminder_body(detail.model_dump(mode="json"))
    contacts = audience_contacts(db, args.event_id, "volunteers")
    return {
        "event_id": args.event_id,
        "body": body,
        "audience": "volunteers",
        "recipient_count": len(contacts),
    }


def send_shift_reminder(db: sqlite3.Connection, args: SendShiftReminderArgs) -> dict:
    """TICKET-40: only reached after the organizer explicitly confirms a

    preview_shift_reminder result (SYSTEM_PROMPT guidance).
    """

    payload = ReminderCreate(body=args.body)
    detail = whatsapp_routes.create_reminder(args.event_id, payload, db)
    return detail.model_dump(mode="json")


def list_completed_event_reports(db: sqlite3.Connection, args: ListCompletedEventReportsArgs) -> dict:
    """TICKET-41.

    Drops participant_names/volunteer_names by default (see TICKET-50) —
    attendees/volunteers counts already answer most organizer questions
    without sending real names to OpenRouter. Pass include_names=True to get
    the name lists back when the organizer's question actually needs them.
    """

    reports = reports_routes.completed_event_reports(db)
    items = [report.model_dump(mode="json") for report in reports]
    if not args.include_names:
        for item in items:
            item.pop("participant_names", None)
            item.pop("volunteer_names", None)
    return {"items": items}


def list_event_certificates(db: sqlite3.Connection, args: ListEventCertificatesArgs) -> dict:
    """TICKET-41.

    Drops download_token (see TICKET-50) — it's a bearer-style secret
    (GET /public/certificates/{token} needs no other auth) that the model
    never needs to answer any question this tool exists to answer, only
    counts/status.
    """

    certificates = whatsapp_routes.list_certificates(args.event_id, db)
    items = [certificate.model_dump(mode="json") for certificate in certificates]
    for item in items:
        item.pop("download_token", None)
        item.pop("link", None)
    return {"items": items}


def preview_certificate_generation(
    db: sqlite3.Connection, args: PreviewCertificateGenerationArgs
) -> dict:
    """TICKET-41: no DB write — counts eligible attendees/volunteers and

    how many already have a delivered certificate.
    """

    events_routes.get_event(args.event_id, db)
    return whatsapp_routes.certificate_recipient_counts(db, args.event_id)


def generate_event_certificates(
    db: sqlite3.Connection, args: GenerateEventCertificatesArgs
) -> dict:
    """TICKET-41: only reached after the organizer explicitly confirms a

    preview_certificate_generation result (SYSTEM_PROMPT guidance) — this
    messages real participants and volunteers on WhatsApp with no undo.
    """

    certificates = whatsapp_routes.generate_certificates(args.event_id, db)
    return {"items": [certificate.model_dump(mode="json") for certificate in certificates]}


TOOL_EXECUTORS = {
    "create_event_draft": create_event_draft,
    "publish_event": publish_event,
    "update_event": update_event,
    "get_event": get_event,
    "list_events": list_events,
    "cancel_event": cancel_event,
    "list_event_templates": list_event_templates,
    "list_volunteers": list_volunteers,
    "list_event_tasks": list_event_tasks,
    "assign_event_task": assign_event_task,
    "update_task_status": update_task_status,
    "list_upcoming_deadlines": list_upcoming_deadlines,
    "list_event_roles": list_event_roles,
    "list_event_signups": list_event_signups,
    "list_pending_signups": list_pending_signups,
    "approve_event_signup": approve_event_signup,
    "list_inventory_items": list_inventory_items,
    "list_inventory_locations": list_inventory_locations,
    "get_stock_levels": get_stock_levels,
    "list_inventory_movements": list_inventory_movements,
    "preview_announcement": preview_announcement,
    "send_announcement": send_announcement,
    "preview_shift_reminder": preview_shift_reminder,
    "send_shift_reminder": send_shift_reminder,
    "list_completed_event_reports": list_completed_event_reports,
    "list_event_certificates": list_event_certificates,
    "preview_certificate_generation": preview_certificate_generation,
    "generate_event_certificates": generate_event_certificates,
}
