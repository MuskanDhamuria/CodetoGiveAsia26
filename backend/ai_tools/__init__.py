"""AI-callable tools that wrap existing event operations.

Everything the LLM can invoke lives here as a thin, in-process wrapper
around `backend.api.routes.events`'s handler functions — never raw SQL,
never a new code path with its own business rules. See
`docs/tickets.md` (TICKET-1/2/3) for the design rationale.
"""

from backend.ai_tools.dispatch import TOOL_SPECS, dispatch_tool_call

__all__ = ["TOOL_SPECS", "dispatch_tool_call"]
