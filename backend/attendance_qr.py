"""Signed tokens for QR-code attendance check-in.

A participant's or volunteer's QR code just encodes a short, HMAC-signed
string identifying who they are and which event it's for — there's no
database table or state involved in generating one. An admin's scanner reads
the code back and calls the attendance-scan endpoint, which re-verifies the
signature before marking anyone present. This keeps forging someone else's
QR code (and inflating attendance numbers) impractical without the server's
secret key.
"""

from __future__ import annotations

import hashlib
import hmac
import os

# Kind prefixes kept intentionally short: the token goes into a QR code, and
# shorter payloads render as simpler, more reliably-scannable codes.
PARTICIPANT_KIND = "P"
VOLUNTEER_KIND = "V"
_VALID_KINDS = (PARTICIPANT_KIND, VOLUNTEER_KIND)

# Truncated signature: enough to make forgery impractical for a hackathon
# demo without bloating the QR code with a full 64-character hex digest.
_SIGNATURE_LENGTH = 16


def _secret() -> bytes:
    # Reuses WHATSAPP_APP_SECRET if set (already a private, per-deployment
    # secret) so there's one fewer env var to configure; falls back to a
    # fixed dev value so this works out of the box locally.
    value = os.environ.get("ATTENDANCE_QR_SECRET") or os.environ.get("WHATSAPP_APP_SECRET")
    return (value or "dev-attendance-qr-secret").encode("utf-8")


def _sign(kind: str, person_id: int, event_id: int) -> str:
    message = f"{kind}.{person_id}.{event_id}".encode("utf-8")
    return hmac.new(_secret(), message, hashlib.sha256).hexdigest()[:_SIGNATURE_LENGTH]


def generate_token(kind: str, person_id: int, event_id: int) -> str:
    if kind not in _VALID_KINDS:
        raise ValueError(f"Unknown attendance QR kind: {kind!r}")
    signature = _sign(kind, person_id, event_id)
    return f"{kind}.{person_id}.{event_id}.{signature}"


def parse_token(token: str) -> tuple[str, int, int] | None:
    """Returns (kind, person_id, event_id) if the token is well-formed and
    its signature checks out, otherwise None."""

    parts = token.strip().split(".")
    if len(parts) != 4:
        return None
    kind, raw_person_id, raw_event_id, signature = parts
    if kind not in _VALID_KINDS:
        return None
    try:
        person_id = int(raw_person_id)
        event_id = int(raw_event_id)
    except ValueError:
        return None
    expected_signature = _sign(kind, person_id, event_id)
    if not hmac.compare_digest(signature, expected_signature):
        return None
    return kind, person_id, event_id
