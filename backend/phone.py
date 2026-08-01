"""Phone number normalization shared by every route that reads or writes
`contact_number`.

Without this, two different-looking inputs that describe the same phone
line — "9123 4567", "+65 9123 4567", "+6591234567" — are treated as
different participants, since matching/uniqueness is plain string equality
against whatever was typed. Funneling every write and every lookup through
`normalize_phone_number` first means they always compare equal. See
docs/tickets.md TICKET-13.
"""

from __future__ import annotations

import phonenumbers

# The participant portal's audience is Singapore-based, so a number typed
# without an explicit country code (no leading "+") is assumed to be local.
# A "+"-prefixed number is parsed using its own country code regardless of
# this default, so other countries are still handled correctly.
DEFAULT_REGION = "SG"


class InvalidPhoneNumberError(ValueError):
    """Raised when a contact number isn't a valid, dialable phone number."""


def normalize_phone_number(raw: str, default_region: str = DEFAULT_REGION) -> str:
    """Parse `raw` and return it in E.164 form (e.g. "+6591234567").

    Raises `InvalidPhoneNumberError` if `raw` can't be parsed as a real,
    dialable number for its (explicit or default) region.
    """

    candidate = raw.strip()
    if not candidate:
        raise InvalidPhoneNumberError("Phone number is empty")

    try:
        parsed = phonenumbers.parse(candidate, default_region)
    except phonenumbers.NumberParseException as error:
        raise InvalidPhoneNumberError(f"Couldn't parse phone number: {raw!r}") from error

    if not phonenumbers.is_valid_number(parsed):
        raise InvalidPhoneNumberError(f"Not a valid phone number: {raw!r}")

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
