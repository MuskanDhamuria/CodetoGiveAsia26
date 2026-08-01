"""Organizer-managed participant profiles, RSVPs, and attendance."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, StringConstraints

from backend.api.routes._common import (
    Connection,
    Pagination,
    as_bool,
    list_envelope,
)

router = APIRouter(tags=["participants"])
NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ParticipantCreate(BaseModel):
    name: NonEmptyText
    contact_number: str | None = None
    email: str | None = None


class ParticipantUpdate(BaseModel):
    name: NonEmptyText | None = None
    contact_number: str | None = None
    email: str | None = None


class ParticipantOut(BaseModel):
    id: int
    name: str
    contact_number: str | None
    email: str | None
    created_at: str
    updated_at: str


class ParticipationCreate(BaseModel):
    participant_id: int
    rsvp_status: bool = False


class ParticipationUpdate(BaseModel):
    rsvp_status: bool | None = None
    attendance: bool | None = None


class ParticipationOut(BaseModel):
    participant_id: int
    name: str
    contact_number: str | None
    email: str | None
    rsvp_status: bool
    attendance: bool | None


def participant_model(row: sqlite3.Row) -> ParticipantOut:
    return ParticipantOut(**dict(row))


def require_participant(db: sqlite3.Connection, participant_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM participants WHERE id = ?", (participant_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Participant {participant_id} was not found")
    return row


def participation_model(db: sqlite3.Connection, event_id: int, participant_id: int):
    row = db.execute(
        """
        SELECT p.id AS participant_id, p.name, p.contact_number, p.email,
               pt.rsvp_status, pt.attendance
        FROM participations pt JOIN participants p ON p.id = pt.participant_id
        WHERE pt.event_id = ? AND pt.participant_id = ?
        """,
        (event_id, participant_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Event participation was not found")
    return ParticipationOut(
        participant_id=row["participant_id"],
        name=row["name"],
        contact_number=row["contact_number"],
        email=row["email"],
        rsvp_status=bool(row["rsvp_status"]),
        attendance=as_bool(row["attendance"]),
    )


@router.get("/participants")
def list_participants(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    q: Annotated[str | None, Query()] = None,
) -> dict:
    params: list[object] = []
    where = "1 = 1"
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        where = "name LIKE ? OR email LIKE ? OR contact_number LIKE ?"
        params = [term, term, term]
    total = db.execute(
        f"SELECT COUNT(*) FROM participants WHERE {where}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM participants WHERE {where}
        ORDER BY name LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope([participant_model(row) for row in rows], total, pagination)


@router.post(
    "/participants", response_model=ParticipantOut, status_code=status.HTTP_201_CREATED
)
def create_participant(payload: ParticipantCreate, db: Connection) -> ParticipantOut:
    try:
        row = db.execute(
            """
            INSERT INTO participants (name, contact_number, email)
            VALUES (?, ?, ?) RETURNING *
            """,
            (payload.name, payload.contact_number, payload.email),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Participant contact number or email already exists") from error
    return participant_model(row)


@router.get("/participants/{participant_id}", response_model=ParticipantOut)
def get_participant(participant_id: int, db: Connection) -> ParticipantOut:
    return participant_model(require_participant(db, participant_id))


@router.patch("/participants/{participant_id}", response_model=ParticipantOut)
def update_participant(
    participant_id: int, payload: ParticipantUpdate, db: Connection
) -> ParticipantOut:
    current = require_participant(db, participant_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return participant_model(current)
    assignments = ", ".join(f"{field} = ?" for field in values)
    try:
        row = db.execute(
            f"UPDATE participants SET {assignments} WHERE id = ? RETURNING *",
            [*values.values(), participant_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Participant contact number or email already exists") from error
    return participant_model(row)


@router.delete("/participants/{participant_id}", status_code=204)
def delete_participant(participant_id: int, db: Connection) -> Response:
    require_participant(db, participant_id)
    db.execute("DELETE FROM participants WHERE id = ?", (participant_id,))
    db.commit()
    return Response(status_code=204)


@router.get("/participants/{participant_id}/events")
def list_participant_events(
    participant_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    attendance: Annotated[bool | None, Query()] = None,
) -> dict:
    require_participant(db, participant_id)
    where = ["pt.participant_id = ?"]
    params: list[object] = [participant_id]
    if attendance is not None:
        where.append("pt.attendance = ?")
        params.append(int(attendance))
    clause = " AND ".join(where)
    total = db.execute(
        f"SELECT COUNT(*) FROM participations pt WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT e.id AS event_id, e.name, e.venue, e.event_date, e.status,
               pt.rsvp_status, pt.attendance
        FROM participations pt JOIN events e ON e.id = pt.event_id
        WHERE {clause} ORDER BY e.event_date DESC LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [
        {
            **dict(row),
            "rsvp_status": bool(row["rsvp_status"]),
            "attendance": as_bool(row["attendance"]),
        }
        for row in rows
    ]
    return list_envelope(items, total, pagination)


@router.post(
    "/events/{event_id}/participants",
    response_model=ParticipationOut,
    status_code=status.HTTP_201_CREATED,
)
def register_participant(
    event_id: int, payload: ParticipationCreate, db: Connection
) -> ParticipationOut:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    require_participant(db, payload.participant_id)
    try:
        db.execute(
            """
            INSERT INTO participations (event_id, participant_id, rsvp_status)
            VALUES (?, ?, ?)
            """,
            (event_id, payload.participant_id, int(payload.rsvp_status)),
        )
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Participant is already registered for this event") from error
    return participation_model(db, event_id, payload.participant_id)


@router.patch(
    "/events/{event_id}/participants/{participant_id}",
    response_model=ParticipationOut,
)
def update_participation(
    event_id: int,
    participant_id: int,
    payload: ParticipationUpdate,
    db: Connection,
) -> ParticipationOut:
    participation_model(db, event_id, participant_id)
    values = payload.model_dump(exclude_unset=True)
    if values:
        assignments = ", ".join(f"{field} = ?" for field in values)
        params = [int(value) if value is not None else None for value in values.values()]
        db.execute(
            f"""
            UPDATE participations SET {assignments}
            WHERE event_id = ? AND participant_id = ?
            """,
            [*params, event_id, participant_id],
        )
        db.commit()
    return participation_model(db, event_id, participant_id)


@router.delete(
    "/events/{event_id}/participants/{participant_id}", status_code=204
)
def remove_participation(
    event_id: int, participant_id: int, db: Connection
) -> Response:
    participation_model(db, event_id, participant_id)
    db.execute(
        "DELETE FROM participations WHERE event_id = ? AND participant_id = ?",
        (event_id, participant_id),
    )
    db.commit()
    return Response(status_code=204)


@router.get(
    "/events/{event_id}/participants",
    summary="List participants and RSVP/attendance data for an event",
)
def list_event_participants(
    event_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    rsvp_status: Annotated[bool | None, Query()] = None,
    attendance: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} was not found")

    where = ["pt.event_id = ?"]
    params: list[object] = [event_id]
    if rsvp_status is not None:
        where.append("pt.rsvp_status = ?")
        params.append(1 if rsvp_status else 0)
    if attendance is not None:
        where.append("pt.attendance = ?")
        params.append(1 if attendance else 0)
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        where.append("(p.name LIKE ? OR p.email LIKE ? OR p.contact_number LIKE ?)")
        params.extend([term, term, term])
    clause = " AND ".join(where)

    total = db.execute(
        f"""
        SELECT COUNT(*) FROM participations pt
        JOIN participants p ON p.id = pt.participant_id
        WHERE {clause}
        """,
        params,
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT p.id AS participant_id, p.name, p.contact_number, p.email,
               pt.rsvp_status, pt.attendance
        FROM participations pt
        JOIN participants p ON p.id = pt.participant_id
        WHERE {clause}
        ORDER BY p.name
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [
        ParticipationOut(
            participant_id=row["participant_id"],
            name=row["name"],
            contact_number=row["contact_number"],
            email=row["email"],
            rsvp_status=bool(row["rsvp_status"]),
            attendance=as_bool(row["attendance"]),
        )
        for row in rows
    ]
    return list_envelope(items, total, pagination)
