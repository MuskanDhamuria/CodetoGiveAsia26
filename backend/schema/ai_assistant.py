"""Request schema for the AI assistant chat endpoint."""

from typing import Literal

from pydantic import BaseModel, Field

from backend.schema.common import NonEmptyText


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: NonEmptyText


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
