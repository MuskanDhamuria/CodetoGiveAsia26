"""Unauthenticated, participant-facing signup endpoints.

Per backend/API_ENDPOINTS.md: "A public signup flow will probably need a
single transactional endpoint that finds or creates the participant and
registers them." Rate limiting and stronger duplicate matching are still
open items before this is production-safe.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from backend.database import connect
from backend.phone import InvalidPhoneNumberError, normalize_phone_number

router = APIRouter(prefix="/public", tags=["public"])


class PublicRsvpIn(BaseModel):
    name: str = Field(min_length=1)
    contact_number: str | None = None
    email: str | None = None
    rsvp_status: bool = True


class PublicSignupIn(BaseModel):
    name: str = Field(min_length=1)
    contact_number: str | None = None
    email: str | None = None


class PublicSignupOut(BaseModel):
    participant_id: int
    participant_name: str
    participant_contact_number: str | None
    participant_email: str | None


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
            participant = _find_or_create_participant(
                connection, body.name.strip(), contact_number, body.email
            )
        return PublicSignupOut(
            participant_id=participant["id"],
            participant_name=participant["name"],
            participant_contact_number=participant["contact_number"],
            participant_email=participant["email"],
        )
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
            participant = _find_or_create_participant(
                connection, body.name.strip(), contact_number, body.email
            )
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
