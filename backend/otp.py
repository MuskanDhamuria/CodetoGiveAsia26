"""Shared helpers for WhatsApp OTP (one-time code) phone verification.

Used by both volunteer accounts (backend/api/routes/volunteer_auth.py, which
has a real login session to authorize the verify/resend calls) and public
participant signup (backend/api/routes/public.py, which has no account/
session system at all — see ``generate_opaque_token`` for how that flow
authorizes a verify call instead).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

OTP_LENGTH = 6
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


def generate_otp_code() -> str:
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def generate_opaque_token() -> str:
    """A random token proving "I'm the one who just signed up", for flows
    with no session/account system to issue a bearer token from instead."""

    return secrets.token_urlsafe(24)


def hash_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def otp_expiry_timestamp() -> str:
    return (datetime.now(UTC) + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()


def is_expired(expires_at: str) -> bool:
    return datetime.now(UTC) > datetime.fromisoformat(expires_at)
