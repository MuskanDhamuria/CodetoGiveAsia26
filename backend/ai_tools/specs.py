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
