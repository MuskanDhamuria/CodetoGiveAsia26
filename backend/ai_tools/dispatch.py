"""Validation pipeline + dispatch for AI tool calls (TICKET-3).

Every tool call passes through three named stages before anything touches
the database:

1. **Schema validation** — parse the LLM's raw arguments against the same
   Pydantic models `backend/schema/events.py` already defines for the human
   HTTP routes (`backend.ai_tools.schemas`), so the two paths can't drift.
2. **Business validation** — deliberately *not* re-implemented here. The
   tool executors in `backend.ai_tools.tools` call straight into
   `backend.api.routes.events`'s handler functions, which already run their
   own business checks (template exists, event exists, etc.) before any
   write. Re-checking the same rules here would just be a second copy that
   could drift from the first.
3. **Permission validation** — `_check_permissions` below. A named,
   explicit pass-through: the admin/organizer backend has no auth or role
   concept at all today (TICKET-0's decision), so there is nothing to check
   yet. Kept as its own step, rather than silently skipped, so a real check
   has an obvious place to plug in later.

Any failure at any stage becomes a structured
``{"success": False, "reason": "..."}`` result instead of a raw exception,
per the proposal's error-handling contract.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from backend.ai_tools.errors import ToolValidationError
from backend.ai_tools.schemas import TOOL_ARG_MODELS
from backend.ai_tools.specs import TOOL_SPECS
from backend.ai_tools.tools import TOOL_EXECUTORS

__all__ = ["TOOL_SPECS", "dispatch_tool_call"]


def _check_permissions(tool_name: str, arguments: dict[str, Any]) -> None:
    """No-op pass-through — see module docstring, stage 3."""

    return None


def _format_validation_error(error: ValidationError) -> str:
    problems = [
        f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}"
        for issue in error.errors()
    ]
    return "; ".join(problems)


def dispatch_tool_call(
    db: sqlite3.Connection, tool_name: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    if tool_name not in TOOL_EXECUTORS:
        return {"success": False, "reason": f"Unknown tool '{tool_name}'"}

    # Stage 1: schema validation.
    try:
        parsed_args = TOOL_ARG_MODELS[tool_name](**arguments)
    except ValidationError as error:
        return {"success": False, "reason": _format_validation_error(error)}

    # Stage 3: permission validation (stage 2, business validation, is
    # reused from events.py inside the executor itself — see docstring).
    _check_permissions(tool_name, arguments)

    # Stage 2/4: business validation + execution, both inside the executor.
    try:
        result = TOOL_EXECUTORS[tool_name](db, parsed_args)
    except ToolValidationError as error:
        return {"success": False, "reason": error.reason}
    except HTTPException as error:
        return {"success": False, "reason": str(error.detail)}

    return {"success": True, "result": result}
