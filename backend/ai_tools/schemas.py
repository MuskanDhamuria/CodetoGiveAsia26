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
from backend.schema.beneficiaries import BeneficiaryCreate, BeneficiaryUpdate
from backend.schema.common import TaskCategory, TaskStatus
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
    """TICKET-41.

    `include_names` defaults to False — see docs/tickets.md TICKET-50: real
    participant/volunteer names for this migrant-worker beneficiary
    population shouldn't leave the system to OpenRouter on every "how did
    the food drive go"-style query when a headcount already answers it. Set
    True only when the organizer's question actually needs the name list
    (e.g. "who attended the food drive").
    """

    model_config = ConfigDict(extra="forbid")

    include_names: bool = Field(
        default=False,
        description=(
            "Set True only when the organizer's question needs the actual "
            "participant/volunteer name list (e.g. 'who attended'). Leave "
            "False for headcount/status questions ('how did it go', 'is the "
            "report done') — attendee/volunteer counts already answer those "
            "without sending real names."
        ),
    )


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


class ListEventParticipantsArgs(BaseModel):
    """TICKET-54: the participant/RSVP roster for one event — "who's

    RSVP'd for Saturday's cleanup?"-style questions.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    rsvp_status: bool | None = None
    attendance: bool | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetParticipantArgs(BaseModel):
    """TICKET-54."""

    model_config = ConfigDict(extra="forbid")

    participant_id: int


class ListParticipantsArgs(BaseModel):
    """TICKET-54: cross-event participant search, e.g. "look up Aisha"."""

    model_config = ConfigDict(extra="forbid")

    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class ListVenuesArgs(BaseModel):
    """TICKET-54."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetVenueArgs(BaseModel):
    """TICKET-54."""

    model_config = ConfigDict(extra="forbid")

    venue_id: int


class ListVenueBookingsArgs(BaseModel):
    """TICKET-54."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class GetAttendanceForecastArgs(BaseModel):
    """TICKET-54: "how many people are we expecting Saturday?" — a

    historical show-up-rate projection, not just the raw RSVP count.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int


class GetEventLogisticsArgs(BaseModel):
    """TICKET-54: "how are we doing operationally for Saturday's event" —

    requirements, venue bookings, attendance forecast, and shortage/late-
    delivery/capacity warnings for one event, all in one call. Named after
    this ticket's own framing of that question as the highest-value miss.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int


class ListEventLogisticsRequirementsArgs(BaseModel):
    """TICKET-54."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class CreateEventTaskArgs(EventTaskCreate):
    """TICKET-55."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class UpdateEventTaskArgs(EventTaskUpdate):
    """TICKET-55."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    task_id: int


class CreateInventoryItemArgs(InventoryItemCreate):
    """TICKET-56."""

    model_config = ConfigDict(extra="forbid")


class UpdateInventoryItemArgs(InventoryItemUpdate):
    """TICKET-56."""

    model_config = ConfigDict(extra="forbid")

    item_id: int


class CreateInventoryLocationArgs(InventoryLocationCreate):
    """TICKET-56."""

    model_config = ConfigDict(extra="forbid")


class UpdateInventoryLocationArgs(InventoryLocationUpdate):
    """TICKET-56."""

    model_config = ConfigDict(extra="forbid")

    location_id: int


class AdjustStockArgs(StockAdjustment):
    """TICKET-56."""

    model_config = ConfigDict(extra="forbid")


class TransferStockArgs(StockTransfer):
    """TICKET-56."""

    model_config = ConfigDict(extra="forbid")


class CreateVenueArgs(VenueCreate):
    """TICKET-57."""

    model_config = ConfigDict(extra="forbid")


class UpdateVenueArgs(VenueUpdate):
    """TICKET-57."""

    model_config = ConfigDict(extra="forbid")

    venue_id: int


class CreateVenueSpaceArgs(VenueSpaceCreate):
    """TICKET-57."""

    model_config = ConfigDict(extra="forbid")

    venue_id: int


class UpdateVenueSpaceArgs(VenueSpaceUpdate):
    """TICKET-57."""

    model_config = ConfigDict(extra="forbid")

    venue_id: int
    space_id: int


class CreateVenueBookingArgs(VenueBookingCreate):
    """TICKET-57."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class UpdateVenueBookingArgs(VenueBookingUpdate):
    """TICKET-57."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    booking_id: int


class CreateEventLogisticsRequirementArgs(EventRequirementCreate):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class UpdateEventLogisticsRequirementArgs(EventRequirementUpdate):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    requirement_id: int


class CancelEventLogisticsRequirementArgs(BaseModel):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    requirement_id: int


class ReserveLogisticsInventoryArgs(ReserveAllocation):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    requirement_id: int


class ReleaseLogisticsInventoryArgs(AllocationQuantity):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    requirement_id: int
    allocation_id: int


class IssueLogisticsInventoryArgs(AllocationQuantity):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    requirement_id: int
    allocation_id: int


class ReconcileLogisticsAllocationArgs(AllocationReconcile):
    """TICKET-58."""

    model_config = ConfigDict(extra="forbid")

    event_id: int
    requirement_id: int
    allocation_id: int


class DeactivateInventoryItemArgs(BaseModel):
    """TICKET-59."""

    model_config = ConfigDict(extra="forbid")

    item_id: int


class DeactivateInventoryLocationArgs(BaseModel):
    """TICKET-59."""

    model_config = ConfigDict(extra="forbid")

    location_id: int


class DeactivateVenueArgs(BaseModel):
    """TICKET-59."""

    model_config = ConfigDict(extra="forbid")

    venue_id: int


class DeactivateVenueSpaceArgs(BaseModel):
    """TICKET-59."""

    model_config = ConfigDict(extra="forbid")

    venue_id: int
    space_id: int


class ReorderEventTasksArgs(TaskOrder):
    """TICKET-60."""

    model_config = ConfigDict(extra="forbid")

    event_id: int


class CreateDonationBatchArgs(DonationBatchCreate):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")


class ListDonationBatchesArgs(BaseModel):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetDonationBatchArgs(BaseModel):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class CollectDonationBatchArgs(BaseModel):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class ReceiveDonationBatchArgs(BaseModel):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class SortDonationBatchArgs(DonationSort):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class CompleteDonationSortingArgs(BaseModel):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class DistributeDonationBatchArgs(DonationSort):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class CloseDonationBatchArgs(BaseModel):
    """TICKET-61."""

    model_config = ConfigDict(extra="forbid")

    batch_id: int


class ListBeneficiariesArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetBeneficiaryArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    beneficiary_id: int


class CreateBeneficiaryArgs(BeneficiaryCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")


class UpdateBeneficiaryArgs(BeneficiaryUpdate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    beneficiary_id: int


class CreateOrganizationArgs(OrganizationCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")


class UpdateOrganizationArgs(OrganizationUpdate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    organization_id: int


class ListOrganizationsArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetOrganizationArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    organization_id: int


class CreateOrganizationContactArgs(ContactCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    organization_id: int


class UpdateOrganizationContactArgs(ContactUpdate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    organization_id: int
    contact_id: int


class CreateSupplierOrderArgs(SupplierOrderCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")


class UpdateSupplierOrderArgs(SupplierOrderUpdate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class ListSupplierOrdersArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetSupplierOrderArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class AddSupplierOrderLineArgs(SupplierOrderLineCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class UpdateSupplierOrderLineArgs(SupplierOrderLineUpdate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int
    line_id: int


class ConfirmSupplierOrderArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class ReceiveSupplierOrderArgs(FulfilmentCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class ReturnSupplierOrderRentalArgs(FulfilmentCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class CompleteSupplierOrderArgs(FulfilmentCreate):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class CancelSupplierOrderArgs(BaseModel):
    """TICKET-62."""

    model_config = ConfigDict(extra="forbid")

    order_id: int


class CreateTeamMemberArgs(TeamMemberCreate):
    """TICKET-63."""

    model_config = ConfigDict(extra="forbid")


class ListTeamMembersArgs(BaseModel):
    """TICKET-63."""

    model_config = ConfigDict(extra="forbid")

    is_active: bool | None = None
    q: str | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class GetTeamMemberArgs(BaseModel):
    """TICKET-63."""

    model_config = ConfigDict(extra="forbid")

    member_id: int


class UpdateTeamMemberArgs(TeamMemberUpdate):
    """TICKET-63."""

    model_config = ConfigDict(extra="forbid")

    member_id: int


class ListTeamMemberTasksArgs(BaseModel):
    """TICKET-63."""

    model_config = ConfigDict(extra="forbid")

    member_id: int
    status: TaskStatus | None = None
    event_id: int | None = None
    due_before: date | None = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)


class RejectEventSignupArgs(BaseModel):
    """TICKET-64: only reached after the organizer explicitly confirms which

    volunteer/signup to reject — see SYSTEM_PROMPT in ai_assistant.py.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: int
    signup_id: int


class CreateEventTemplateArgs(TemplateCreate):
    """TICKET-65."""

    model_config = ConfigDict(extra="forbid")


class UpdateEventTemplateArgs(TemplateUpdate):
    """TICKET-65."""

    model_config = ConfigDict(extra="forbid")

    template_id: int


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
    "list_event_participants": ListEventParticipantsArgs,
    "get_participant": GetParticipantArgs,
    "list_participants": ListParticipantsArgs,
    "list_venues": ListVenuesArgs,
    "get_venue": GetVenueArgs,
    "list_venue_bookings": ListVenueBookingsArgs,
    "get_attendance_forecast": GetAttendanceForecastArgs,
    "get_event_logistics": GetEventLogisticsArgs,
    "list_event_logistics_requirements": ListEventLogisticsRequirementsArgs,
    "create_event_task": CreateEventTaskArgs,
    "update_event_task": UpdateEventTaskArgs,
    "create_inventory_item": CreateInventoryItemArgs,
    "update_inventory_item": UpdateInventoryItemArgs,
    "create_inventory_location": CreateInventoryLocationArgs,
    "update_inventory_location": UpdateInventoryLocationArgs,
    "adjust_stock": AdjustStockArgs,
    "transfer_stock": TransferStockArgs,
    "create_venue": CreateVenueArgs,
    "update_venue": UpdateVenueArgs,
    "create_venue_space": CreateVenueSpaceArgs,
    "update_venue_space": UpdateVenueSpaceArgs,
    "create_venue_booking": CreateVenueBookingArgs,
    "update_venue_booking": UpdateVenueBookingArgs,
    "create_event_logistics_requirement": CreateEventLogisticsRequirementArgs,
    "update_event_logistics_requirement": UpdateEventLogisticsRequirementArgs,
    "cancel_event_logistics_requirement": CancelEventLogisticsRequirementArgs,
    "reserve_logistics_inventory": ReserveLogisticsInventoryArgs,
    "release_logistics_inventory": ReleaseLogisticsInventoryArgs,
    "issue_logistics_inventory": IssueLogisticsInventoryArgs,
    "reconcile_logistics_allocation": ReconcileLogisticsAllocationArgs,
    "deactivate_inventory_item": DeactivateInventoryItemArgs,
    "deactivate_inventory_location": DeactivateInventoryLocationArgs,
    "deactivate_venue": DeactivateVenueArgs,
    "deactivate_venue_space": DeactivateVenueSpaceArgs,
    "reorder_event_tasks": ReorderEventTasksArgs,
    "create_donation_batch": CreateDonationBatchArgs,
    "list_donation_batches": ListDonationBatchesArgs,
    "get_donation_batch": GetDonationBatchArgs,
    "collect_donation_batch": CollectDonationBatchArgs,
    "receive_donation_batch": ReceiveDonationBatchArgs,
    "sort_donation_batch": SortDonationBatchArgs,
    "complete_donation_sorting": CompleteDonationSortingArgs,
    "distribute_donation_batch": DistributeDonationBatchArgs,
    "close_donation_batch": CloseDonationBatchArgs,
    "list_beneficiaries": ListBeneficiariesArgs,
    "get_beneficiary": GetBeneficiaryArgs,
    "create_beneficiary": CreateBeneficiaryArgs,
    "update_beneficiary": UpdateBeneficiaryArgs,
    "create_organization": CreateOrganizationArgs,
    "update_organization": UpdateOrganizationArgs,
    "list_organizations": ListOrganizationsArgs,
    "get_organization": GetOrganizationArgs,
    "create_organization_contact": CreateOrganizationContactArgs,
    "update_organization_contact": UpdateOrganizationContactArgs,
    "create_supplier_order": CreateSupplierOrderArgs,
    "update_supplier_order": UpdateSupplierOrderArgs,
    "list_supplier_orders": ListSupplierOrdersArgs,
    "get_supplier_order": GetSupplierOrderArgs,
    "add_supplier_order_line": AddSupplierOrderLineArgs,
    "update_supplier_order_line": UpdateSupplierOrderLineArgs,
    "confirm_supplier_order": ConfirmSupplierOrderArgs,
    "receive_supplier_order": ReceiveSupplierOrderArgs,
    "return_supplier_order_rental": ReturnSupplierOrderRentalArgs,
    "complete_supplier_order": CompleteSupplierOrderArgs,
    "cancel_supplier_order": CancelSupplierOrderArgs,
    "create_team_member": CreateTeamMemberArgs,
    "list_team_members": ListTeamMembersArgs,
    "get_team_member": GetTeamMemberArgs,
    "update_team_member": UpdateTeamMemberArgs,
    "list_team_member_tasks": ListTeamMemberTasksArgs,
    "reject_event_signup": RejectEventSignupArgs,
    "create_event_template": CreateEventTemplateArgs,
    "update_event_template": UpdateEventTemplateArgs,
}
