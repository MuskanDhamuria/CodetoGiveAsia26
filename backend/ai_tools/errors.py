"""Structured error type for the AI tool validation pipeline."""

from __future__ import annotations


class ToolValidationError(Exception):
    """Raised by a business-validation step; carries a plain-language reason."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason
