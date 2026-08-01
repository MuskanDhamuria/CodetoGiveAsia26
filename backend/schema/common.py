"""Shared API field types."""

from typing import Annotated, Literal

from pydantic import StringConstraints


NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
TaskCategory = Literal["planning", "execution", "post_execution"]
TaskStatus = Literal["incomplete", "ongoing", "done"]
EventStatus = Literal["open", "closed"]
