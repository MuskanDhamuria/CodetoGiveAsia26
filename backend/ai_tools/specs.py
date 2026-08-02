"""OpenAI/OpenRouter-style function-calling tool specs for TICKET-1.

Parameters are generated from the same argument models used for schema
validation (`backend.ai_tools.schemas.TOOL_ARG_MODELS`), so the tool
definitions sent to the LLM can never drift from what the dispatch pipeline
actually accepts.
"""

from __future__ import annotations

from backend.ai_tools.schemas import TOOL_ARG_MODELS

TOOL_DESCRIPTIONS: dict[str, str] = {
    "create_event_draft": (
        "Validate a proposed event and return it as a draft for the "
        "organizer to review. Does not create anything yet — always call "
        "this before publish_event."
    ),
    "publish_event": (
        "Create a real event from an approved draft. Only call this after "
        "the organizer has explicitly confirmed the draft from "
        "create_event_draft."
    ),
    "update_event": "Update fields on an existing event.",
    "get_event": "Look up a single event and its tasks by id.",
    "list_events": "List events, optionally filtered by status, date range, template, or search text.",
    "cancel_event": (
        "Cancel an event. This is different from closing registration: a "
        "cancelled event stops accepting RSVPs and is marked cancelled "
        "everywhere it's shown. This does not delete the event or its "
        "history."
    ),
    "list_event_templates": (
        "List existing event templates (id, name, description). Call this "
        "before create_event_draft whenever the organizer mentions a "
        "template by name or you need to check what templates exist — "
        "match by name to find the right id rather than asking the "
        "organizer for a raw numeric id. event_template_id is optional: "
        "if nothing matches, proceed with null instead of treating it as "
        "missing required information."
    ),
    "list_volunteers": (
        "List volunteer profiles with their skills and signup counts, "
        "optionally filtered by signup status, a skill id, an interested "
        "role id, or free-text search on name/email/phone."
    ),
    "list_event_tasks": (
        "List an event's tasks, optionally filtered by category, status, "
        "assigned team member, or due-date range. Use this instead of "
        "get_event when the organizer only wants to know what's still "
        "outstanding rather than the full event."
    ),
    "assign_event_task": (
        "Assign a task to a team member, or unassign it by passing "
        "team_member_id: null. Task assignment always targets a team "
        "member, never a volunteer."
    ),
    "update_task_status": (
        "Set a task's status: 'ongoing' to start it, 'done' to complete "
        "it, or 'incomplete' to reopen it."
    ),
    "list_upcoming_deadlines": (
        "List not-yet-done tasks across every event due within the next N "
        "days (default 14), ordered soonest first. Use this instead of "
        "list_event_tasks when the question spans more than one event."
    ),
    "list_event_roles": "List the volunteer roles available for an event.",
    "list_event_signups": (
        "List volunteer signup requests/assignments for an event, "
        "optionally filtered by status (requested/approved/rejected), "
        "role, attendance, or search text."
    ),
    "list_pending_signups": (
        "List volunteer signup requests/assignments across every event "
        "(not just one), optionally filtered by status "
        "(requested/approved/rejected), role, attendance, or search text. "
        "Use this instead of list_event_signups when the organizer names "
        "no specific event — e.g. 'which volunteers haven't been "
        "approved yet?'. Each result includes its event_id/event_name so "
        "you can group by event and ask the organizer which one to act on."
    ),
    "approve_event_signup": (
        "Approve a volunteer's signup and assign them to a role. Only call "
        "this after the organizer has explicitly confirmed which volunteer "
        "and role — never approve a signup on your own recommendation "
        "alone."
    ),
    "list_inventory_items": "List inventory catalogue items (name, SKU, unit, type, reorder level).",
    "list_inventory_locations": "List inventory storage locations.",
    "get_stock_levels": (
        "Get current on-hand/reserved/available stock for every item at "
        "every location, including which combinations are at or below "
        "their reorder level."
    ),
    "list_inventory_movements": "List the stock movement ledger (adjustments and transfers), most recent first.",
    "preview_announcement": (
        "Draft an announcement for an event's audience and see the "
        "recipient count — does not send anything. Always call this "
        "before send_announcement."
    ),
    "send_announcement": (
        "Send a real WhatsApp announcement to an event's audience. This "
        "cannot be undone — only call after the organizer has explicitly "
        "confirmed the exact draft from preview_announcement."
    ),
    "preview_shift_reminder": (
        "Draft a shift reminder for an event's approved volunteers and see "
        "the recipient count — does not send anything. Always call this "
        "before send_shift_reminder."
    ),
    "send_shift_reminder": (
        "Send a real WhatsApp shift reminder to an event's approved "
        "volunteers. This cannot be undone — only call after the "
        "organizer has explicitly confirmed the exact draft from "
        "preview_shift_reminder."
    ),
    "list_completed_event_reports": (
        "List completed (closed) events with post-event report status, "
        "attendee/volunteer counts, and partner names."
    ),
    "list_event_certificates": "List certificates already issued for an event.",
    "preview_certificate_generation": (
        "Count how many attendees/volunteers are eligible for a "
        "certificate and how many already have one delivered — does not "
        "create or send anything. Always call this before "
        "generate_event_certificates."
    ),
    "generate_event_certificates": (
        "Generate certificates for everyone with recorded attendance at an "
        "event and message the download links to them on WhatsApp. This "
        "cannot be undone — only call after the organizer has explicitly "
        "confirmed based on preview_certificate_generation."
    ),
    "list_event_participants": (
        "List the participant/RSVP roster for one event — who's registered, "
        "cancelled, or marked attended. Filter by rsvp_status/attendance or "
        "search by name/contact/email with q."
    ),
    "get_participant": "Look up a single participant by id, including contact details.",
    "list_participants": (
        "Search participants by name/contact/email across all events "
        "(not scoped to one event) — use list_event_participants instead "
        "when the organizer names a specific event."
    ),
    "list_venues": "List venues and their bookable spaces.",
    "get_venue": "Look up a single venue, its spaces, and its recent bookings.",
    "list_venue_bookings": "List venue-space bookings for one event.",
    "get_attendance_forecast": (
        "Project expected attendance for one event from historical show-up "
        "rates at similar past events (same template, or same beneficiary "
        "group if there's not enough template history). Use this for "
        "'how many people are we expecting' questions rather than just "
        "the raw RSVP count."
    ),
    "get_event_logistics": (
        "Full operational picture for one event in one call: logistics "
        "requirements, venue bookings, the attendance forecast, and "
        "shortage/late-delivery/capacity warnings. Use this for 'how are "
        "we doing operationally for Saturday's event'-style questions."
    ),
    "list_event_logistics_requirements": (
        "List the goods/services logistics requirements for one event "
        "(quantities needed, sourced, on-site, still-to-source)."
    ),
    "create_event_task": "Create a new task on an event.",
    "update_event_task": (
        "Update fields on an existing event task (name, due date, category, "
        "status, position). Use assign_event_task instead if you only need "
        "to change who it's assigned to."
    ),
    "create_inventory_item": "Add a new inventory catalogue item (name, SKU, unit, type, reorder level).",
    "update_inventory_item": "Update an inventory catalogue item's fields.",
    "create_inventory_location": "Add a new inventory storage location.",
    "update_inventory_location": "Update an inventory storage location's fields.",
    "adjust_stock": (
        "Record a stock adjustment (correction, receipt of new stock, "
        "write-off) for one item at one location. Use a positive "
        "quantity_delta to add stock, negative to remove it."
    ),
    "transfer_stock": "Move stock for one item from one location to another.",
    "create_venue": "Add a new venue.",
    "update_venue": "Update a venue's fields.",
    "create_venue_space": "Add a new bookable space within a venue.",
    "update_venue_space": "Update a venue space's fields.",
    "create_venue_booking": (
        "Book a venue space for an event. Confirmed bookings are checked "
        "for overlapping confirmed bookings on the same space and rejected "
        "if one exists."
    ),
    "update_venue_booking": (
        "Update an existing venue booking (times, status, space, etc.). "
        "Same overlap check as create_venue_booking applies when the "
        "result is 'confirmed'."
    ),
    "create_event_logistics_requirement": (
        "Add a new goods/service logistics requirement to an event."
    ),
    "update_event_logistics_requirement": (
        "Update an event logistics requirement's fields (quantity, "
        "deadline, priority, notes)."
    ),
    "cancel_event_logistics_requirement": (
        "Cancel an event logistics requirement. Any issued inventory must "
        "be reconciled first."
    ),
    "reserve_logistics_inventory": (
        "Reserve inventory stock at a location against a goods "
        "requirement. Fails if available stock is insufficient."
    ),
    "release_logistics_inventory": (
        "Release some or all of a reserved (not yet issued) inventory "
        "allocation back to available stock."
    ),
    "issue_logistics_inventory": (
        "Issue reserved inventory for actual use — deducts it from stock. "
        "Only call after the organizer has confirmed the reservation is "
        "ready to be issued."
    ),
    "reconcile_logistics_allocation": (
        "Record final outcomes (returned/consumed/damaged/lost/"
        "distributed quantities) for an issued allocation after the event "
        "is closed. The four quantities must sum to exactly the issued "
        "quantity."
    ),
    "deactivate_inventory_item": "Deactivate an inventory catalogue item. Reversible (update_inventory_item can reactivate it) — not a delete.",
    "deactivate_inventory_location": "Deactivate an inventory storage location. Reversible — not a delete.",
    "deactivate_venue": "Deactivate a venue and all of its bookable spaces. Reversible — not a delete.",
    "deactivate_venue_space": "Deactivate a single bookable space within a venue. Reversible — not a delete.",
    "reorder_event_tasks": (
        "Set the display order of an event's tasks. task_ids must contain "
        "every current task id for the event exactly once."
    ),
    "create_donation_batch": "Start a new donation batch (an incoming donation to track through collection, sorting, and distribution).",
    "list_donation_batches": "List donation batches with their status and quantities by condition.",
    "get_donation_batch": "Look up a single donation batch, including quantities sorted so far and how much has been distributed.",
    "collect_donation_batch": "Mark a donation batch as collected.",
    "receive_donation_batch": "Mark a donation batch as received.",
    "sort_donation_batch": (
        "Sort part of a received donation batch into inventory as usable/damaged/expired stock at a location. "
        "Moves the batch into 'sorting' status."
    ),
    "complete_donation_sorting": "Mark a donation batch's sorting as complete.",
    "distribute_donation_batch": "Distribute sorted donation stock out of inventory (deducts from stock, marks the batch distributed).",
    "close_donation_batch": "Close a donation batch once its lifecycle is finished.",
    "list_beneficiaries": "List beneficiary groups, optionally filtered by search text.",
    "get_beneficiary": "Look up a single beneficiary group by id.",
    "create_beneficiary": "Add a new beneficiary group.",
    "update_beneficiary": "Update a beneficiary group's name.",
    "create_organization": "Add a new external organization (supplier, donor, venue partner, etc.).",
    "update_organization": "Update an external organization's fields, including its capabilities list.",
    "list_organizations": "List external organizations.",
    "get_organization": "Look up a single external organization, its contacts, linked events, and supplier orders.",
    "create_organization_contact": "Add a contact person to an external organization.",
    "update_organization_contact": "Update an external organization contact's fields.",
    "create_supplier_order": "Create a new supplier order (purchase, rental, or service) with an external organization.",
    "update_supplier_order": "Update a draft supplier order's fields. Only draft orders can be edited.",
    "list_supplier_orders": "List supplier orders.",
    "get_supplier_order": "Look up a single supplier order, its lines, and fulfilment history.",
    "add_supplier_order_line": "Add a line item to a draft supplier order.",
    "update_supplier_order_line": "Update a line item on a draft supplier order.",
    "confirm_supplier_order": "Confirm a draft supplier order. Requires at least one line.",
    "receive_supplier_order": "Record a receipt/delivery against a confirmed or in-progress supplier order line.",
    "return_supplier_order_rental": "Record a rental return against an active rental supplier order line.",
    "complete_supplier_order": "Mark a supplier order complete. All delivered/purchased quantities must be accounted for first.",
    "cancel_supplier_order": "Cancel a draft, confirmed, or in-progress supplier order.",
    "create_team_member": "Add a new team member (internal organizer/staff).",
    "list_team_members": "List team members, optionally filtered by active status or search text.",
    "get_team_member": "Look up a single team member by id.",
    "update_team_member": (
        "Update a team member's fields. To retire a team member, pass "
        "is_active: false rather than deleting them."
    ),
    "list_team_member_tasks": "List the event tasks assigned to a single team member.",
    "reject_event_signup": (
        "Reject a volunteer's signup for an event. Only call this after "
        "the organizer has explicitly confirmed which volunteer/signup to "
        "reject — never decide this on your own recommendation alone."
    ),
    "create_event_template": "Create a new event template.",
    "update_event_template": "Update an existing event template's fields.",
}


def _tool_spec(name: str) -> dict:
    model = TOOL_ARG_MODELS[name]
    schema = model.model_json_schema()
    schema.pop("title", None)
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": TOOL_DESCRIPTIONS[name],
            "parameters": schema,
        },
    }


TOOL_SPECS: list[dict] = [_tool_spec(name) for name in TOOL_ARG_MODELS]
