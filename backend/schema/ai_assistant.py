"""Request schemas for the AI assistant endpoints."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.schema.common import NonEmptyText


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: NonEmptyText


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


class ToolInvocationRequest(BaseModel):
    """Body for directly invoking one AI tool, bypassing the LLM (TICKET-6).

    Used by the frontend's draft-approval flow: once the organizer confirms
    a `create_event_draft` preview, the panel calls `publish_event` with the
    (possibly edited) draft fields directly, rather than sending another chat
    turn and hoping the model re-issues the same tool call.
    """

    arguments: dict[str, Any] = Field(default_factory=dict)
