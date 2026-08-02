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
