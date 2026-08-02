"""Unauthenticated, participant-facing signup endpoints.

Per backend/API_ENDPOINTS.md: "A public signup flow will probably need a
single transactional endpoint that finds or creates the participant and
registers them." Rate limiting and stronger duplicate matching are still
open items before this is production-safe.
"""

from __future__ import annotations

import hmac
import logging
import os
import sqlite3
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, StringConstraints

from backend.bot.commands import get_or_create_contact
from backend.database import connect
from backend.integrations.whatsapp_client import get_client
from backend.otp import (
    OTP_MAX_ATTEMPTS,
    generate_opaque_token,
    generate_otp_code,
    hash_value,
    is_expired,
    otp_expiry_timestamp,
)
from backend.phone import InvalidPhoneNumberError, normalize_phone_number

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public", tags=["public"])

# Stripped before the min_length check runs, not just before storage — a
# name of " " (whitespace only) previously passed `min_length=1` and then
# stored as "" once `.strip()` was applied at the call site. See
# docs/tickets.md TICKET-47.
NonBlankName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ParticipantNameMismatchError(Exception):
    """Raised when a submitted name doesn't match the participant already
    on file for the given contact number/email.

    See docs/tickets.md TICKET-42: matching purely by contact_number/email
    and silently returning whatever participant was found let anyone who
    knew (or guessed) someone else's phone number get attached to that
    person's existing record under a different name, with no error and no
    warning — an account-takeover vector. Requiring the typed name to match
    (case/whitespace-insensitively) before reusing a match, and erroring
    otherwise, closes that off without requiring a full auth system.
    """

    def __init__(self, existing_name: str) -> None:
        self.existing_name = existing_name
        super().__init__(
            "This contact number or email is already registered under a different "
            "name. If this is you, sign in with that name instead."
        )


class WhatsAppConfigOut(BaseModel):
    number: str


@router.get("/whatsapp-config", response_model=WhatsAppConfigOut)
def whatsapp_config() -> WhatsAppConfigOut:
    """The Cloud API number the "Chat on WhatsApp" links should point at.

    Read at request time (not baked into the frontend build) so the number
    can be changed just by updating the backend's WHATSAPP_DISPLAY_NUMBER
    env var — no rebuild/redeploy of the frontend needed.
    """

    number = os.environ.get("WHATSAPP_DISPLAY_NUMBER", "6580000000")
    return WhatsAppConfigOut(number=number)


class PublicRsvpIn(BaseModel):
    name: NonBlankName
    contact_number: str | None = None
    email: str | None = None
    rsvp_status: bool = True


class PublicSignupIn(BaseModel):
    name: NonBlankName
    contact_number: str | None = None
    email: str | None = None


class PublicSignupOut(BaseModel):
    participant_id: int
    participant_name: str
    participant_contact_number: str | None
    participant_email: str | None
    # False whenever a phone number was provided and hasn't been verified
    # yet (true, with no verify_token, when signing up with email only —
    # there's nothing to verify). See verify_participant_otp below.
    phone_verified: bool
    verify_token: str | None = None


class PublicVerifyOtpIn(BaseModel):
    verify_token: str
    code: str


class PublicResendOtpIn(BaseModel):
    verify_token: str


class PublicOtpOut(BaseModel):
    phone_verified: bool
    verify_token: str | None = None


class PublicRsvpOut(BaseModel):
    participant_id: int
    # The participant record actually matched/created — not an echo of the
    # submitted body. `_find_or_create_participant` may attach this RSVP to
    # a pre-existing participant (matched by contact_number/email) whose
    # name differs from what was just typed; returning the canonical record
    # lets the frontend store/display the real identity instead of quietly
    # trusting unverified form input. See docs/tickets.md TICKET-12/TICKET-15.
    participant_name: str
    participant_contact_number: str | None
    participant_email: str | None
    event_id: int
    rsvp_status: bool


def _find_or_create_participant(
    connection: sqlite3.Connection,
    name: str,
    contact_number: str | None,
    email: str | None,
) -> sqlite3.Row:
    row = None
    if contact_number:
        row = connection.execute(
            "SELECT * FROM participants WHERE contact_number = ?", (contact_number,)
        ).fetchone()
    if row is None and email:
        row = connection.execute(
            "SELECT * FROM participants WHERE email = ? COLLATE NOCASE", (email,)
        ).fetchone()
    if row is not None:
        if row["name"].strip().casefold() != name.strip().casefold():
            raise ParticipantNameMismatchError(row["name"])
        return row

    try:
        return connection.execute(
            "INSERT INTO participants (name, contact_number, email) "
            "VALUES (?, ?, ?) RETURNING *",
            (name, contact_number, email),
        ).fetchone()
    except sqlite3.IntegrityError:
        # Lost a race with a concurrent signup using the same contact/email.
        row = connection.execute(
            "SELECT * FROM participants WHERE contact_number = ? OR email = ? COLLATE NOCASE",
            (contact_number, email),
        ).fetchone()
        if row is None:
            raise
        return row


# --------------------------------------------------------------------------- #
# WhatsApp OTP verification
#
# Only POST /signup (the "Create account" form, no event attached) sends an
# OTP — event RSVP and the WhatsApp bot's own SIGNUP flow are unaffected.
# Participants have no account/session system to authorize a verify call
# with, so /signup instead hands back a one-time opaque `verify_token`
# alongside participant_id; verify/resend-otp require it. See backend/otp.py
# (generate_opaque_token) and backend/api/routes/volunteer_auth.py for the
# equivalent flow for volunteers, which uses a real login session instead.
# --------------------------------------------------------------------------- #
def _issue_and_send_participant_otp(
    connection: sqlite3.Connection, participant_id: int, phone: str
) -> str:
    code = generate_otp_code()
    token = generate_opaque_token()
    with connection:
        connection.execute(
            """
            UPDATE participants
            SET otp_code_hash = ?, otp_expires_at = ?, otp_attempts = 0,
                otp_verify_token_hash = ?
            WHERE id = ?
            """,
            (hash_value(code), otp_expiry_timestamp(), hash_value(token), participant_id),
        )
    try:
        get_client().send_template(
            phone,
            template_name=os.environ.get("WHATSAPP_OTP_TEMPLATE_NAME", "otp"),
            language_code=os.environ.get("WHATSAPP_OTP_TEMPLATE_LANG", "en_US"),
            body_params=[code],
            button_param=code,
            button_sub_type=os.environ.get("WHATSAPP_OTP_TEMPLATE_BUTTON_TYPE", "url"),
        )
    except Exception:
        # Signup/resend already succeeded and committed above; a failed
        # WhatsApp delivery shouldn't make the request look like it failed.
        logger.exception("Failed to send OTP WhatsApp template to %s", phone)
    return token


@router.post(
    "/signup",
    response_model=PublicSignupOut,
    status_code=status.HTTP_201_CREATED,
)
def public_signup(body: PublicSignupIn, request: Request) -> PublicSignupOut:
    """Create (or find) a participant account without registering for an event."""
    if not body.contact_number and not body.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Provide a contact number or email to sign up"
        )

    contact_number = None
    if body.contact_number:
        try:
            contact_number = normalize_phone_number(body.contact_number)
        except InvalidPhoneNumberError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    connection = connect(request.app.state.database_path)
    try:
        with connection:
            try:
                participant = _find_or_create_participant(
                    connection, body.name, contact_number, body.email
                )
            except ParticipantNameMismatchError as error:
                raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error

        verify_token = None
        phone_verified = participant["phone_verified_at"] is not None
        if participant["contact_number"] and not phone_verified:
            # Auto-link this phone to the WhatsApp bot, same as the
            # volunteer registration flow — never overwrites an existing
            # link to a different participant.
            contact = get_or_create_contact(connection, participant["contact_number"])
            if contact["participant_id"] is None and contact["volunteer_id"] is None:
                connection.execute(
                    "UPDATE whatsapp_contacts SET participant_id = ? WHERE id = ?",
                    (participant["id"], contact["id"]),
                )
                connection.commit()
            verify_token = _issue_and_send_participant_otp(
                connection, participant["id"], participant["contact_number"]
            )
        elif not participant["contact_number"]:
            # Signed up with email only — nothing to verify over WhatsApp.
            phone_verified = True

        return PublicSignupOut(
            participant_id=participant["id"],
            participant_name=participant["name"],
            participant_contact_number=participant["contact_number"],
            participant_email=participant["email"],
            phone_verified=phone_verified,
            verify_token=verify_token,
        )
    finally:
        connection.close()


@router.post("/participants/{participant_id}/verify-otp", response_model=PublicOtpOut)
def verify_participant_otp(
    participant_id: int, body: PublicVerifyOtpIn, request: Request
) -> PublicOtpOut:
    connection = connect(request.app.state.database_path)
    try:
        participant = connection.execute(
            "SELECT * FROM participants WHERE id = ?", (participant_id,)
        ).fetchone()
        if participant is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
        if participant["phone_verified_at"] is not None:
            return PublicOtpOut(phone_verified=True)
        if participant["otp_verify_token_hash"] is None or not hmac.compare_digest(
            hash_value(body.verify_token), participant["otp_verify_token_hash"]
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired verification session.")
        if participant["otp_code_hash"] is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "No verification code is pending. Request a new one."
            )
        if participant["otp_attempts"] >= OTP_MAX_ATTEMPTS:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Request a new code.")
        if is_expired(participant["otp_expires_at"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This code has expired. Request a new one.")
        if not hmac.compare_digest(hash_value(body.code.strip()), participant["otp_code_hash"]):
            connection.execute(
                "UPDATE participants SET otp_attempts = otp_attempts + 1 WHERE id = ?",
                (participant_id,),
            )
            connection.commit()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is incorrect.")

        with connection:
            connection.execute(
                """
                UPDATE participants
                SET phone_verified_at = CURRENT_TIMESTAMP, otp_code_hash = NULL,
                    otp_expires_at = NULL, otp_attempts = 0, otp_verify_token_hash = NULL
                WHERE id = ?
                """,
                (participant_id,),
            )
        try:
            get_client().send_text(
                participant["contact_number"],
                f"You're verified, {participant['name'].split(' ')[0]}! Welcome to Passion to "
                "Serve — reply HELP anytime to see what I can do.",
            )
        except Exception:
            logger.exception(
                "Verified participant %s but failed to send welcome WhatsApp message to %s",
                participant_id,
                participant["contact_number"],
            )
        return PublicOtpOut(phone_verified=True)
    finally:
        connection.close()


@router.post("/participants/{participant_id}/resend-otp", response_model=PublicOtpOut)
def resend_participant_otp(
    participant_id: int, body: PublicResendOtpIn, request: Request
) -> PublicOtpOut:
    connection = connect(request.app.state.database_path)
    try:
        participant = connection.execute(
            "SELECT * FROM participants WHERE id = ?", (participant_id,)
        ).fetchone()
        if participant is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
        if participant["phone_verified_at"] is not None:
            return PublicOtpOut(phone_verified=True)
        if participant["otp_verify_token_hash"] is None or not hmac.compare_digest(
            hash_value(body.verify_token), participant["otp_verify_token_hash"]
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired verification session.")
        if not participant["contact_number"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No phone number on file to verify.")
        new_token = _issue_and_send_participant_otp(
            connection, participant_id, participant["contact_number"]
        )
        return PublicOtpOut(phone_verified=False, verify_token=new_token)
    finally:
        connection.close()


@router.post(
    "/events/{event_id}/rsvp",
    response_model=PublicRsvpOut,
    status_code=status.HTTP_201_CREATED,
)
def public_rsvp(event_id: int, body: PublicRsvpIn, request: Request) -> PublicRsvpOut:
    if not body.contact_number and not body.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Provide a contact number or email to sign up"
        )

    contact_number = None
    if body.contact_number:
        try:
            contact_number = normalize_phone_number(body.contact_number)
        except InvalidPhoneNumberError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    connection = connect(request.app.state.database_path)
    try:
        event = connection.execute(
            "SELECT status FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if event is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
        if event["status"] == "closed":
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Registration is closed for this event"
            )

        with connection:
            try:
                participant = _find_or_create_participant(
                    connection, body.name, contact_number, body.email
                )
            except ParticipantNameMismatchError as error:
                raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
            existing = connection.execute(
                "SELECT id FROM participations WHERE event_id = ? AND participant_id = ?",
                (event_id, participant["id"]),
            ).fetchone()
            if existing:
                connection.execute(
                    "UPDATE participations SET rsvp_status = ? WHERE id = ?",
                    (int(body.rsvp_status), existing["id"]),
                )
            else:
                connection.execute(
                    "INSERT INTO participations (event_id, participant_id, rsvp_status) "
                    "VALUES (?, ?, ?)",
                    (event_id, participant["id"], int(body.rsvp_status)),
                )
        return PublicRsvpOut(
            participant_id=participant["id"],
            participant_name=participant["name"],
            participant_contact_number=participant["contact_number"],
            participant_email=participant["email"],
            event_id=event_id,
            rsvp_status=body.rsvp_status,
        )
    finally:
        connection.close()
