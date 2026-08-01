"""Participant profiles and their RSVP/attendance history.

See backend/API_ENDPOINTS.md's "Participants and RSVPs" section.
"""

from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from backend.database import connect
from backend.phone import InvalidPhoneNumberError, normalize_phone_number

router = APIRouter(prefix="/participants", tags=["participants"])


class ParticipantIn(BaseModel):
    name: str = Field(min_length=1)
    contact_number: str | None = None
    email: str | None = None


class ParticipantOut(BaseModel):
    id: int
    name: str
    contact_number: str | None
    email: str | None


class ParticipantListResponse(BaseModel):
    items: list[ParticipantOut]
    total: int
    limit: int
    offset: int


class EventForParticipant(BaseModel):
    id: int
    name: str
    venue: str
    description: str | None
    event_date: str
    status: Literal["open", "closed"]
    rsvp_status: bool
    attendance: bool | None


class ParticipantEventsResponse(BaseModel):
    items: list[EventForParticipant]
    total: int
    limit: int
    offset: int


def _db(request: Request) -> sqlite3.Connection:
    return connect(request.app.state.database_path)


def _row_to_participant(row: sqlite3.Row) -> ParticipantOut:
    return ParticipantOut(
        id=row["id"],
        name=row["name"],
        contact_number=row["contact_number"],
        email=row["email"],
    )


@router.get("", response_model=ParticipantListResponse)
def list_participants(
    request: Request,
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ParticipantListResponse:
    connection = _db(request)
    try:
        where = ""
        params: list[object] = []
        if q:
            where = "WHERE name LIKE ? OR email LIKE ? OR contact_number LIKE ?"
            like = f"%{q.strip()}%"
            params = [like, like, like]

        total = connection.execute(
            f"SELECT COUNT(*) FROM participants {where}", params
        ).fetchone()[0]
        rows = connection.execute(
            f"SELECT * FROM participants {where} ORDER BY id LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return ParticipantListResponse(
            items=[_row_to_participant(row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
    finally:
        connection.close()


@router.post("", response_model=ParticipantOut, status_code=status.HTTP_201_CREATED)
def create_participant(body: ParticipantIn, request: Request) -> ParticipantOut:
    connection = _db(request)
    try:
        contact_number = None
        if body.contact_number:
            try:
                contact_number = normalize_phone_number(body.contact_number)
            except InvalidPhoneNumberError as error:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

        try:
            with connection:
                row = connection.execute(
                    "INSERT INTO participants (name, contact_number, email) "
                    "VALUES (?, ?, ?) RETURNING *",
                    (body.name.strip(), contact_number, body.email),
                ).fetchone()
        except sqlite3.IntegrityError as error:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A participant with that contact number or email already exists",
            ) from error
        return _row_to_participant(row)
    finally:
        connection.close()


@router.get("/lookup", response_model=ParticipantOut)
def lookup_participant(
    request: Request,
    contact_number: str = Query(min_length=1),
) -> ParticipantOut:
    """Exact, side-effect-free lookup by phone number.

    Registered ahead of `/{participant_id}` — "lookup" would otherwise match
    that route's path pattern first and fail int validation with a 422
    instead of running this handler. Used to restore a participant's local
    identity ("sign in") on a new device/browser without registering them
    for an event as a side effect. See docs/tickets.md TICKET-1.
    """

    connection = _db(request)
    try:
        try:
            normalized = normalize_phone_number(contact_number)
        except InvalidPhoneNumberError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

        row = connection.execute(
            "SELECT * FROM participants WHERE contact_number = ?", (normalized,)
        ).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
        return _row_to_participant(row)
    finally:
        connection.close()


@router.get("/{participant_id}", response_model=ParticipantOut)
def get_participant(participant_id: int, request: Request) -> ParticipantOut:
    connection = _db(request)
    try:
        row = connection.execute(
            "SELECT * FROM participants WHERE id = ?", (participant_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
        return _row_to_participant(row)
    finally:
        connection.close()


@router.get("/{participant_id}/events", response_model=ParticipantEventsResponse)
def list_participant_events(
    participant_id: int,
    request: Request,
    attendance: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ParticipantEventsResponse:
    connection = _db(request)
    try:
        exists = connection.execute(
            "SELECT 1 FROM participants WHERE id = ?", (participant_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")

        where = "WHERE p.participant_id = ? AND p.rsvp_status = 1"
        params: list[object] = [participant_id]
        if attendance is not None:
            where += " AND p.attendance = ?"
            params.append(1 if attendance else 0)

        total = connection.execute(
            f"""
            SELECT COUNT(*) FROM participations p
            JOIN events e ON e.id = p.event_id
            {where}
            """,
            params,
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT e.*, p.rsvp_status AS p_rsvp_status, p.attendance AS p_attendance
            FROM participations p
            JOIN events e ON e.id = p.event_id
            {where}
            ORDER BY e.event_date
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        items = [
            EventForParticipant(
                id=row["id"],
                name=row["name"],
                venue=row["venue"],
                description=row["description"],
                event_date=row["event_date"],
                status=row["status"],
                rsvp_status=bool(row["p_rsvp_status"]),
                attendance=None if row["p_attendance"] is None else bool(row["p_attendance"]),
            )
            for row in rows
        ]
        return ParticipantEventsResponse(items=items, total=total, limit=limit, offset=offset)
    finally:
        connection.close()
