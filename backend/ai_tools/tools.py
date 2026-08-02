"""Tool executors — thin wrappers around the existing event route handlers.

Each function here takes an already-schema-validated argument model (see
`backend.ai_tools.schemas`) and a `sqlite3.Connection`, and calls straight
into `backend.api.routes.events`'s handler functions in-process. No SQL, no
business logic lives here — see TICKET-2 in docs/tickets.md for why.
"""

from __future__ import annotations

import sqlite3

from backend.api.routes import beneficiaries as beneficiaries_routes
from backend.api.routes import dashboard as dashboard_routes
from backend.api.routes import event_templates as event_templates_routes
from backend.api.routes import events as events_routes
from backend.api.routes import inventory as inventory_routes
from backend.api.routes import logistics as logistics_routes
from backend.api.routes import organizations as organizations_routes
from backend.api.routes import participants as participants_routes
from backend.api.routes import reports as reports_routes
from backend.api.routes import team_members as team_members_routes
from backend.api.routes import venues as venues_routes
from backend.api.routes import volunteers as volunteers_routes
from backend.api.routes import whatsapp as whatsapp_routes
from backend.api.routes._common import Pagination
from backend.bot.commands import audience_contacts
from backend.ai_tools.schemas import (
    AddSupplierOrderLineArgs,
    AdjustStockArgs,
    ApproveEventSignupArgs,
    AssignEventTaskArgs,
    CancelEventArgs,
    CancelEventLogisticsRequirementArgs,
    CancelSupplierOrderArgs,
    CloseDonationBatchArgs,
    CollectDonationBatchArgs,
    CompleteDonationSortingArgs,
    CompleteSupplierOrderArgs,
    ConfirmSupplierOrderArgs,
    CreateBeneficiaryArgs,
    CreateDonationBatchArgs,
    CreateEventDraftArgs,
    CreateEventLogisticsRequirementArgs,
    CreateEventTaskArgs,
    CreateEventTemplateArgs,
    CreateInventoryItemArgs,
    CreateInventoryLocationArgs,
    CreateOrganizationArgs,
    CreateOrganizationContactArgs,
    CreateSupplierOrderArgs,
    CreateTeamMemberArgs,
    CreateVenueArgs,
    CreateVenueBookingArgs,
    CreateVenueSpaceArgs,
    DeactivateInventoryItemArgs,
    DeactivateInventoryLocationArgs,
    DeactivateVenueArgs,
    DeactivateVenueSpaceArgs,
    DistributeDonationBatchArgs,
    GenerateEventCertificatesArgs,
    GetAttendanceForecastArgs,
    GetBeneficiaryArgs,
    GetDonationBatchArgs,
    GetEventArgs,
    GetEventLogisticsArgs,
    GetOrganizationArgs,
    GetParticipantArgs,
    GetStockLevelsArgs,
    GetSupplierOrderArgs,
    GetTeamMemberArgs,
    GetVenueArgs,
    IssueLogisticsInventoryArgs,
    ListBeneficiariesArgs,
    ListCompletedEventReportsArgs,
    ListDonationBatchesArgs,
    ListEventCertificatesArgs,
    ListEventLogisticsRequirementsArgs,
    ListEventParticipantsArgs,
    ListEventRolesArgs,
    ListEventSignupsArgs,
    ListEventsArgs,
    ListEventTasksArgs,
    ListEventTemplatesArgs,
    ListInventoryItemsArgs,
    ListInventoryLocationsArgs,
    ListInventoryMovementsArgs,
    ListOrganizationsArgs,
    ListParticipantsArgs,
    ListPendingSignupsArgs,
    ListSupplierOrdersArgs,
    ListTeamMemberTasksArgs,
    ListTeamMembersArgs,
    ListUpcomingDeadlinesArgs,
    ListVenueBookingsArgs,
    ListVenuesArgs,
    ListVolunteersArgs,
    PreviewAnnouncementArgs,
    PreviewCertificateGenerationArgs,
    PreviewShiftReminderArgs,
    PublishEventArgs,
    ReceiveDonationBatchArgs,
    ReceiveSupplierOrderArgs,
    ReconcileLogisticsAllocationArgs,
    RejectEventSignupArgs,
    ReleaseLogisticsInventoryArgs,
    ReorderEventTasksArgs,
    ReserveLogisticsInventoryArgs,
    ReturnSupplierOrderRentalArgs,
    SendAnnouncementArgs,
    SendShiftReminderArgs,
    SortDonationBatchArgs,
    TransferStockArgs,
    UpdateBeneficiaryArgs,
    UpdateEventArgs,
    UpdateEventLogisticsRequirementArgs,
    UpdateEventTaskArgs,
    UpdateEventTemplateArgs,
    UpdateInventoryItemArgs,
    UpdateInventoryLocationArgs,
    UpdateOrganizationArgs,
    UpdateOrganizationContactArgs,
    UpdateSupplierOrderArgs,
    UpdateSupplierOrderLineArgs,
    UpdateTaskStatusArgs,
    UpdateTeamMemberArgs,
    UpdateVenueArgs,
    UpdateVenueBookingArgs,
    UpdateVenueSpaceArgs,
)
from backend.schema.beneficiaries import BeneficiaryCreate, BeneficiaryUpdate
from backend.schema.event_templates import TemplateCreate, TemplateUpdate
from backend.schema.events import EventCreate, EventTaskCreate, EventTaskUpdate, EventUpdate, TaskOrder
from backend.schema.inventory import (
    InventoryItemCreate,
    InventoryItemUpdate,
    InventoryLocationCreate,
    InventoryLocationUpdate,
    StockAdjustment,
    StockTransfer,
)
from backend.schema.logistics import (
    AllocationQuantity,
    AllocationReconcile,
    EventRequirementCreate,
    EventRequirementUpdate,
    ReserveAllocation,
)
from backend.schema.organizations import (
    ContactCreate,
    ContactUpdate,
    FulfilmentCreate,
    OrganizationCreate,
    OrganizationUpdate,
    SupplierOrderCreate,
    SupplierOrderLineCreate,
    SupplierOrderLineUpdate,
    SupplierOrderUpdate,
)
from backend.schema.team_members import TeamMemberCreate, TeamMemberUpdate
from backend.schema.venues import (
    DonationBatchCreate,
    DonationSort,
    VenueBookingCreate,
    VenueBookingUpdate,
    VenueCreate,
    VenueSpaceCreate,
    VenueSpaceUpdate,
    VenueUpdate,
)
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


def list_event_participants(db: sqlite3.Connection, args: ListEventParticipantsArgs) -> dict:
    """TICKET-54: read-only. The participant/RSVP side of event management,

    distinct from volunteers — previously invisible to the AI entirely.
    """

    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = participants_routes.list_event_participants(
        args.event_id,
        db,
        pagination,
        rsvp_status=args.rsvp_status,
        attendance=args.attendance,
        q=args.q,
    )
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def get_participant(db: sqlite3.Connection, args: GetParticipantArgs) -> dict:
    """TICKET-54."""

    participant = participants_routes.get_participant(args.participant_id, db)
    return participant.model_dump(mode="json")


def list_participants(db: sqlite3.Connection, args: ListParticipantsArgs) -> dict:
    """TICKET-54."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = participants_routes.list_participants(db, pagination, q=args.q)
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def list_venues(db: sqlite3.Connection, args: ListVenuesArgs) -> dict:
    """TICKET-54: read-only. Write tools (create/update venue, bookings) are

    deliberately not wired up yet, same as inventory's TICKET-39 precedent —
    no organizer chat use case identified for mutating venue data yet.
    """

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return venues_routes.list_venues(db, pagination)


def get_venue(db: sqlite3.Connection, args: GetVenueArgs) -> dict:
    """TICKET-54."""

    return venues_routes.get_venue(args.venue_id, db)


def list_venue_bookings(db: sqlite3.Connection, args: ListVenueBookingsArgs) -> dict:
    """TICKET-54."""

    return venues_routes.list_bookings(args.event_id, db)


def get_attendance_forecast(db: sqlite3.Connection, args: GetAttendanceForecastArgs) -> dict:
    """TICKET-54: historical show-up-rate projection for one event — "how

    many people are we expecting Saturday?"
    """

    return logistics_routes.attendance_forecast(db, args.event_id)


def get_event_logistics(db: sqlite3.Connection, args: GetEventLogisticsArgs) -> dict:
    """TICKET-54: requirements, venue bookings, attendance forecast, and

    shortage/late-delivery/capacity warnings for one event in one call —
    the ticket's own highest-priority miss ("how are we doing operationally
    for Saturday's event").
    """

    return logistics_routes.event_logistics(args.event_id, db)


def list_event_logistics_requirements(
    db: sqlite3.Connection, args: ListEventLogisticsRequirementsArgs
) -> dict:
    """TICKET-54."""

    return logistics_routes.list_event_requirements(args.event_id, db)


def create_event_task(db: sqlite3.Connection, args: CreateEventTaskArgs) -> dict:
    """TICKET-55."""

    payload = EventTaskCreate(**args.model_dump(exclude={"event_id"}))
    detail = events_routes.create_event_task(args.event_id, payload, db)
    return detail.model_dump(mode="json")


def update_event_task(db: sqlite3.Connection, args: UpdateEventTaskArgs) -> dict:
    """TICKET-55."""

    fields = args.model_dump(exclude={"event_id", "task_id"}, exclude_unset=True)
    payload = EventTaskUpdate(**fields)
    detail = events_routes.update_event_task(args.event_id, args.task_id, payload, db)
    return detail.model_dump(mode="json")


def create_inventory_item(db: sqlite3.Connection, args: CreateInventoryItemArgs) -> dict:
    """TICKET-56."""

    payload = InventoryItemCreate(**args.model_dump())
    return inventory_routes.create_item(payload, db)


def update_inventory_item(db: sqlite3.Connection, args: UpdateInventoryItemArgs) -> dict:
    """TICKET-56."""

    fields = args.model_dump(exclude={"item_id"}, exclude_unset=True)
    payload = InventoryItemUpdate(**fields)
    return inventory_routes.update_item(args.item_id, payload, db)


def create_inventory_location(db: sqlite3.Connection, args: CreateInventoryLocationArgs) -> dict:
    """TICKET-56."""

    payload = InventoryLocationCreate(**args.model_dump())
    return inventory_routes.create_location(payload, db)


def update_inventory_location(db: sqlite3.Connection, args: UpdateInventoryLocationArgs) -> dict:
    """TICKET-56."""

    fields = args.model_dump(exclude={"location_id"}, exclude_unset=True)
    payload = InventoryLocationUpdate(**fields)
    return inventory_routes.update_location(args.location_id, payload, db)


def adjust_stock(db: sqlite3.Connection, args: AdjustStockArgs) -> dict:
    """TICKET-56."""

    payload = StockAdjustment(**args.model_dump())
    return inventory_routes.adjust_stock(payload, db)


def transfer_stock(db: sqlite3.Connection, args: TransferStockArgs) -> dict:
    """TICKET-56."""

    payload = StockTransfer(**args.model_dump())
    return inventory_routes.transfer_stock(payload, db)


def create_venue(db: sqlite3.Connection, args: CreateVenueArgs) -> dict:
    """TICKET-57."""

    payload = VenueCreate(**args.model_dump())
    return venues_routes.create_venue(payload, db)


def update_venue(db: sqlite3.Connection, args: UpdateVenueArgs) -> dict:
    """TICKET-57."""

    fields = args.model_dump(exclude={"venue_id"}, exclude_unset=True)
    payload = VenueUpdate(**fields)
    return venues_routes.update_venue(args.venue_id, payload, db)


def create_venue_space(db: sqlite3.Connection, args: CreateVenueSpaceArgs) -> dict:
    """TICKET-57."""

    payload = VenueSpaceCreate(**args.model_dump(exclude={"venue_id"}))
    return venues_routes.create_space(args.venue_id, payload, db)


def update_venue_space(db: sqlite3.Connection, args: UpdateVenueSpaceArgs) -> dict:
    """TICKET-57."""

    fields = args.model_dump(exclude={"venue_id", "space_id"}, exclude_unset=True)
    payload = VenueSpaceUpdate(**fields)
    return venues_routes.update_space(args.venue_id, args.space_id, payload, db)


def create_venue_booking(db: sqlite3.Connection, args: CreateVenueBookingArgs) -> dict:
    """TICKET-57. `ensure_no_overlap` runs inside `create_booking` itself —

    not duplicated here.
    """

    payload = VenueBookingCreate(**args.model_dump(exclude={"event_id"}))
    return venues_routes.create_booking(args.event_id, payload, db)


def update_venue_booking(db: sqlite3.Connection, args: UpdateVenueBookingArgs) -> dict:
    """TICKET-57."""

    fields = args.model_dump(exclude={"event_id", "booking_id"}, exclude_unset=True)
    payload = VenueBookingUpdate(**fields)
    return venues_routes.update_booking(args.event_id, args.booking_id, payload, db)


def create_event_logistics_requirement(
    db: sqlite3.Connection, args: CreateEventLogisticsRequirementArgs
) -> dict:
    """TICKET-58."""

    payload = EventRequirementCreate(**args.model_dump(exclude={"event_id"}))
    return logistics_routes.create_event_requirement(args.event_id, payload, db)


def update_event_logistics_requirement(
    db: sqlite3.Connection, args: UpdateEventLogisticsRequirementArgs
) -> dict:
    """TICKET-58."""

    fields = args.model_dump(exclude={"event_id", "requirement_id"}, exclude_unset=True)
    payload = EventRequirementUpdate(**fields)
    return logistics_routes.update_event_requirement(args.event_id, args.requirement_id, payload, db)


def cancel_event_logistics_requirement(
    db: sqlite3.Connection, args: CancelEventLogisticsRequirementArgs
) -> dict:
    """TICKET-58. Reuses `cancel_event_requirement`, which itself dispatches

    to `update_event_requirement(is_cancelled=True)` — no separate copy of
    that business rule here.
    """

    logistics_routes.cancel_event_requirement(args.event_id, args.requirement_id, db)
    return {"event_id": args.event_id, "requirement_id": args.requirement_id, "is_cancelled": True}


def reserve_logistics_inventory(db: sqlite3.Connection, args: ReserveLogisticsInventoryArgs) -> dict:
    """TICKET-58."""

    payload = ReserveAllocation(**args.model_dump(exclude={"event_id", "requirement_id"}))
    return logistics_routes.reserve_inventory(args.event_id, args.requirement_id, payload, db)


def release_logistics_inventory(db: sqlite3.Connection, args: ReleaseLogisticsInventoryArgs) -> dict:
    """TICKET-58."""

    payload = AllocationQuantity(**args.model_dump(exclude={"event_id", "requirement_id", "allocation_id"}))
    return logistics_routes.release_inventory(
        args.event_id, args.requirement_id, args.allocation_id, payload, db
    )


def issue_logistics_inventory(db: sqlite3.Connection, args: IssueLogisticsInventoryArgs) -> dict:
    """TICKET-58."""

    payload = AllocationQuantity(**args.model_dump(exclude={"event_id", "requirement_id", "allocation_id"}))
    return logistics_routes.issue_inventory(
        args.event_id, args.requirement_id, args.allocation_id, payload, db
    )


def reconcile_logistics_allocation(
    db: sqlite3.Connection, args: ReconcileLogisticsAllocationArgs
) -> dict:
    """TICKET-58."""

    payload = AllocationReconcile(
        **args.model_dump(exclude={"event_id", "requirement_id", "allocation_id"})
    )
    return logistics_routes.reconcile_allocation(
        args.event_id, args.requirement_id, args.allocation_id, payload, db
    )


def deactivate_inventory_item(db: sqlite3.Connection, args: DeactivateInventoryItemArgs) -> dict:
    """TICKET-59: reversible is_active flip, not a delete."""

    inventory_routes.deactivate_item(args.item_id, db)
    return {"item_id": args.item_id, "is_active": False}


def deactivate_inventory_location(db: sqlite3.Connection, args: DeactivateInventoryLocationArgs) -> dict:
    """TICKET-59."""

    inventory_routes.deactivate_location(args.location_id, db)
    return {"location_id": args.location_id, "is_active": False}


def deactivate_venue(db: sqlite3.Connection, args: DeactivateVenueArgs) -> dict:
    """TICKET-59: cascades to the venue's spaces, same as the human route."""

    venues_routes.deactivate_venue(args.venue_id, db)
    return {"venue_id": args.venue_id, "is_active": False}


def deactivate_venue_space(db: sqlite3.Connection, args: DeactivateVenueSpaceArgs) -> dict:
    """TICKET-59."""

    venues_routes.deactivate_space(args.venue_id, args.space_id, db)
    return {"venue_id": args.venue_id, "space_id": args.space_id, "is_active": False}


def reorder_event_tasks(db: sqlite3.Connection, args: ReorderEventTasksArgs) -> dict:
    """TICKET-60."""

    payload = TaskOrder(task_ids=args.task_ids)
    tasks = events_routes.reorder_event_tasks(args.event_id, payload, db)
    return {"items": [task.model_dump(mode="json") for task in tasks]}


def create_donation_batch(db: sqlite3.Connection, args: CreateDonationBatchArgs) -> dict:
    """TICKET-61."""

    payload = DonationBatchCreate(**args.model_dump())
    return venues_routes.create_donation(payload, db)


def list_donation_batches(db: sqlite3.Connection, args: ListDonationBatchesArgs) -> dict:
    """TICKET-61."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return venues_routes.list_donations(db, pagination)


def get_donation_batch(db: sqlite3.Connection, args: GetDonationBatchArgs) -> dict:
    """TICKET-61."""

    return venues_routes.get_donation(args.batch_id, db)


def collect_donation_batch(db: sqlite3.Connection, args: CollectDonationBatchArgs) -> dict:
    """TICKET-61."""

    return venues_routes.collect_donation(args.batch_id, db)


def receive_donation_batch(db: sqlite3.Connection, args: ReceiveDonationBatchArgs) -> dict:
    """TICKET-61."""

    return venues_routes.receive_donation(args.batch_id, db)


def sort_donation_batch(db: sqlite3.Connection, args: SortDonationBatchArgs) -> dict:
    """TICKET-61."""

    payload = DonationSort(**args.model_dump(exclude={"batch_id"}))
    return venues_routes.sort_donation(args.batch_id, payload, db)


def complete_donation_sorting(db: sqlite3.Connection, args: CompleteDonationSortingArgs) -> dict:
    """TICKET-61."""

    return venues_routes.complete_sorting(args.batch_id, db)


def distribute_donation_batch(db: sqlite3.Connection, args: DistributeDonationBatchArgs) -> dict:
    """TICKET-61."""

    payload = DonationSort(**args.model_dump(exclude={"batch_id"}))
    return venues_routes.distribute_donation(args.batch_id, payload, db)


def close_donation_batch(db: sqlite3.Connection, args: CloseDonationBatchArgs) -> dict:
    """TICKET-61."""

    return venues_routes.close_donation(args.batch_id, db)


def list_beneficiaries(db: sqlite3.Connection, args: ListBeneficiariesArgs) -> dict:
    """TICKET-62."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = beneficiaries_routes.list_beneficiaries(db, pagination, q=args.q)
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def get_beneficiary(db: sqlite3.Connection, args: GetBeneficiaryArgs) -> dict:
    """TICKET-62."""

    beneficiary = beneficiaries_routes.get_beneficiary(args.beneficiary_id, db)
    return beneficiary.model_dump(mode="json")


def create_beneficiary(db: sqlite3.Connection, args: CreateBeneficiaryArgs) -> dict:
    """TICKET-62."""

    payload = BeneficiaryCreate(**args.model_dump())
    beneficiary = beneficiaries_routes.create_beneficiary(payload, db)
    return beneficiary.model_dump(mode="json")


def update_beneficiary(db: sqlite3.Connection, args: UpdateBeneficiaryArgs) -> dict:
    """TICKET-62."""

    fields = args.model_dump(exclude={"beneficiary_id"}, exclude_unset=True)
    payload = BeneficiaryUpdate(**fields)
    beneficiary = beneficiaries_routes.update_beneficiary(args.beneficiary_id, payload, db)
    return beneficiary.model_dump(mode="json")


def create_organization(db: sqlite3.Connection, args: CreateOrganizationArgs) -> dict:
    """TICKET-62."""

    payload = OrganizationCreate(**args.model_dump())
    return organizations_routes.create_organization(payload, db)


def update_organization(db: sqlite3.Connection, args: UpdateOrganizationArgs) -> dict:
    """TICKET-62."""

    fields = args.model_dump(exclude={"organization_id"}, exclude_unset=True)
    payload = OrganizationUpdate(**fields)
    return organizations_routes.update_organization(args.organization_id, payload, db)


def list_organizations(db: sqlite3.Connection, args: ListOrganizationsArgs) -> dict:
    """TICKET-62."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return organizations_routes.list_organizations(db, pagination)


def get_organization(db: sqlite3.Connection, args: GetOrganizationArgs) -> dict:
    """TICKET-62."""

    return organizations_routes.get_organization(args.organization_id, db)


def create_organization_contact(db: sqlite3.Connection, args: CreateOrganizationContactArgs) -> dict:
    """TICKET-62."""

    payload = ContactCreate(**args.model_dump(exclude={"organization_id"}))
    return organizations_routes.create_contact(args.organization_id, payload, db)


def update_organization_contact(db: sqlite3.Connection, args: UpdateOrganizationContactArgs) -> dict:
    """TICKET-62."""

    fields = args.model_dump(exclude={"organization_id", "contact_id"}, exclude_unset=True)
    payload = ContactUpdate(**fields)
    return organizations_routes.update_contact(args.organization_id, args.contact_id, payload, db)


def create_supplier_order(db: sqlite3.Connection, args: CreateSupplierOrderArgs) -> dict:
    """TICKET-62."""

    payload = SupplierOrderCreate(**args.model_dump())
    return organizations_routes.create_order(payload, db)


def update_supplier_order(db: sqlite3.Connection, args: UpdateSupplierOrderArgs) -> dict:
    """TICKET-62."""

    fields = args.model_dump(exclude={"order_id"}, exclude_unset=True)
    payload = SupplierOrderUpdate(**fields)
    return organizations_routes.update_order(args.order_id, payload, db)


def list_supplier_orders(db: sqlite3.Connection, args: ListSupplierOrdersArgs) -> dict:
    """TICKET-62."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return organizations_routes.list_orders(db, pagination)


def get_supplier_order(db: sqlite3.Connection, args: GetSupplierOrderArgs) -> dict:
    """TICKET-62."""

    return organizations_routes.get_order(args.order_id, db)


def add_supplier_order_line(db: sqlite3.Connection, args: AddSupplierOrderLineArgs) -> dict:
    """TICKET-62."""

    payload = SupplierOrderLineCreate(**args.model_dump(exclude={"order_id"}))
    return organizations_routes.add_order_line(args.order_id, payload, db)


def update_supplier_order_line(db: sqlite3.Connection, args: UpdateSupplierOrderLineArgs) -> dict:
    """TICKET-62."""

    fields = args.model_dump(exclude={"order_id", "line_id"}, exclude_unset=True)
    payload = SupplierOrderLineUpdate(**fields)
    return organizations_routes.update_order_line(args.order_id, args.line_id, payload, db)


def confirm_supplier_order(db: sqlite3.Connection, args: ConfirmSupplierOrderArgs) -> dict:
    """TICKET-62."""

    return organizations_routes.confirm_order(args.order_id, db)


def receive_supplier_order(db: sqlite3.Connection, args: ReceiveSupplierOrderArgs) -> dict:
    """TICKET-62."""

    payload = FulfilmentCreate(**args.model_dump(exclude={"order_id"}))
    return organizations_routes.receive_order(args.order_id, payload, db)


def return_supplier_order_rental(db: sqlite3.Connection, args: ReturnSupplierOrderRentalArgs) -> dict:
    """TICKET-62."""

    payload = FulfilmentCreate(**args.model_dump(exclude={"order_id"}))
    return organizations_routes.return_rental(args.order_id, payload, db)


def complete_supplier_order(db: sqlite3.Connection, args: CompleteSupplierOrderArgs) -> dict:
    """TICKET-62."""

    payload = FulfilmentCreate(**args.model_dump(exclude={"order_id"}))
    return organizations_routes.complete_order(args.order_id, payload, db)


def cancel_supplier_order(db: sqlite3.Connection, args: CancelSupplierOrderArgs) -> dict:
    """TICKET-62."""

    return organizations_routes.cancel_order(args.order_id, db)


def create_team_member(db: sqlite3.Connection, args: CreateTeamMemberArgs) -> dict:
    """TICKET-63."""

    payload = TeamMemberCreate(**args.model_dump())
    member = team_members_routes.create_team_member(payload, db)
    return member.model_dump(mode="json")


def list_team_members(db: sqlite3.Connection, args: ListTeamMembersArgs) -> dict:
    """TICKET-63."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    envelope = team_members_routes.list_team_members(db, pagination, is_active=args.is_active, q=args.q)
    return {
        **envelope,
        "items": [item.model_dump(mode="json") for item in envelope["items"]],
    }


def get_team_member(db: sqlite3.Connection, args: GetTeamMemberArgs) -> dict:
    """TICKET-63."""

    member = team_members_routes.get_team_member(args.member_id, db)
    return member.model_dump(mode="json")


def update_team_member(db: sqlite3.Connection, args: UpdateTeamMemberArgs) -> dict:
    """TICKET-63: to retire a team member, pass is_active=False rather than

    deleting — delete_team_member is a hard delete and stays human-only.
    """

    fields = args.model_dump(exclude={"member_id"}, exclude_unset=True)
    payload = TeamMemberUpdate(**fields)
    member = team_members_routes.update_team_member(args.member_id, payload, db)
    return member.model_dump(mode="json")


def list_team_member_tasks(db: sqlite3.Connection, args: ListTeamMemberTasksArgs) -> dict:
    """TICKET-63."""

    pagination = Pagination(limit=args.limit, offset=args.offset)
    return team_members_routes.list_team_member_tasks(
        args.member_id,
        db,
        pagination,
        task_status=args.status,
        event_id=args.event_id,
        due_before=args.due_before.isoformat() if args.due_before else None,
    )


def reject_event_signup(db: sqlite3.Connection, args: RejectEventSignupArgs) -> dict:
    """TICKET-64: only reached after the organizer explicitly confirms which

    volunteer/signup to reject (mirrors approve_event_signup's guidance).
    """

    detail = volunteers_routes.reject_event_signup(args.event_id, args.signup_id, db)
    return detail.model_dump(mode="json")


def create_event_template(db: sqlite3.Connection, args: CreateEventTemplateArgs) -> dict:
    """TICKET-65."""

    payload = TemplateCreate(**args.model_dump())
    template = event_templates_routes.create_template(payload, db)
    return template.model_dump(mode="json")


def update_event_template(db: sqlite3.Connection, args: UpdateEventTemplateArgs) -> dict:
    """TICKET-65."""

    fields = args.model_dump(exclude={"template_id"}, exclude_unset=True)
    payload = TemplateUpdate(**fields)
    template = event_templates_routes.update_template(args.template_id, payload, db)
    return template.model_dump(mode="json")


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
    "list_event_participants": list_event_participants,
    "get_participant": get_participant,
    "list_participants": list_participants,
    "list_venues": list_venues,
    "get_venue": get_venue,
    "list_venue_bookings": list_venue_bookings,
    "get_attendance_forecast": get_attendance_forecast,
    "get_event_logistics": get_event_logistics,
    "list_event_logistics_requirements": list_event_logistics_requirements,
    "create_event_task": create_event_task,
    "update_event_task": update_event_task,
    "create_inventory_item": create_inventory_item,
    "update_inventory_item": update_inventory_item,
    "create_inventory_location": create_inventory_location,
    "update_inventory_location": update_inventory_location,
    "adjust_stock": adjust_stock,
    "transfer_stock": transfer_stock,
    "create_venue": create_venue,
    "update_venue": update_venue,
    "create_venue_space": create_venue_space,
    "update_venue_space": update_venue_space,
    "create_venue_booking": create_venue_booking,
    "update_venue_booking": update_venue_booking,
    "create_event_logistics_requirement": create_event_logistics_requirement,
    "update_event_logistics_requirement": update_event_logistics_requirement,
    "cancel_event_logistics_requirement": cancel_event_logistics_requirement,
    "reserve_logistics_inventory": reserve_logistics_inventory,
    "release_logistics_inventory": release_logistics_inventory,
    "issue_logistics_inventory": issue_logistics_inventory,
    "reconcile_logistics_allocation": reconcile_logistics_allocation,
    "deactivate_inventory_item": deactivate_inventory_item,
    "deactivate_inventory_location": deactivate_inventory_location,
    "deactivate_venue": deactivate_venue,
    "deactivate_venue_space": deactivate_venue_space,
    "reorder_event_tasks": reorder_event_tasks,
    "create_donation_batch": create_donation_batch,
    "list_donation_batches": list_donation_batches,
    "get_donation_batch": get_donation_batch,
    "collect_donation_batch": collect_donation_batch,
    "receive_donation_batch": receive_donation_batch,
    "sort_donation_batch": sort_donation_batch,
    "complete_donation_sorting": complete_donation_sorting,
    "distribute_donation_batch": distribute_donation_batch,
    "close_donation_batch": close_donation_batch,
    "list_beneficiaries": list_beneficiaries,
    "get_beneficiary": get_beneficiary,
    "create_beneficiary": create_beneficiary,
    "update_beneficiary": update_beneficiary,
    "create_organization": create_organization,
    "update_organization": update_organization,
    "list_organizations": list_organizations,
    "get_organization": get_organization,
    "create_organization_contact": create_organization_contact,
    "update_organization_contact": update_organization_contact,
    "create_supplier_order": create_supplier_order,
    "update_supplier_order": update_supplier_order,
    "list_supplier_orders": list_supplier_orders,
    "get_supplier_order": get_supplier_order,
    "add_supplier_order_line": add_supplier_order_line,
    "update_supplier_order_line": update_supplier_order_line,
    "confirm_supplier_order": confirm_supplier_order,
    "receive_supplier_order": receive_supplier_order,
    "return_supplier_order_rental": return_supplier_order_rental,
    "complete_supplier_order": complete_supplier_order,
    "cancel_supplier_order": cancel_supplier_order,
    "create_team_member": create_team_member,
    "list_team_members": list_team_members,
    "get_team_member": get_team_member,
    "update_team_member": update_team_member,
    "list_team_member_tasks": list_team_member_tasks,
    "reject_event_signup": reject_event_signup,
    "create_event_template": create_event_template,
    "update_event_template": update_event_template,
}
