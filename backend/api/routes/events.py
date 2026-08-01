"""Event browsing and event-scoped participant registration.

Read-only listing/detail plus the participant-registration sub-resource live
here per backend/API_ENDPOINTS.md. Event authoring (create/update/close/
reopen/reschedule) is intentionally not implemented yet — that belongs to
whoever builds organizer-side event management.
"""

from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel

from backend.database import connect

router = APIRouter(prefix="/events", tags=["events"])


class EventOut(BaseModel):
    id: int
    name: str
    venue: str
    description: str | None
    event_date: str
    status: Literal["open", "closed"]


class EventListResponse(BaseModel):
    items: list[EventOut]
    total: int
    limit: int
    offset: int


class RegisterParticipantIn(BaseModel):
    participant_id: int
    rsvp_status: bool = True


class ParticipationOut(BaseModel):
    event_id: int
    participant_id: int
    rsvp_status: bool
    attendance: bool | None


class UpdateParticipationIn(BaseModel):
    rsvp_status: bool | None = None
    attendance: bool | None = None


def _db(request: Request) -> sqlite3.Connection:
    return connect(request.app.state.database_path)


def _row_to_event(row: sqlite3.Row) -> EventOut:
    return EventOut(
        id=row["id"],
        name=row["name"],
        venue=row["venue"],
        description=row["description"],
        event_date=row["event_date"],
        status=row["status"],
    )


def _row_to_participation(row: sqlite3.Row) -> ParticipationOut:
    return ParticipationOut(
        event_id=row["event_id"],
        participant_id=row["participant_id"],
        rsvp_status=bool(row["rsvp_status"]),
        attendance=None if row["attendance"] is None else bool(row["attendance"]),
    )


@router.get("", response_model=EventListResponse)
def list_events(
    request: Request,
    status_filter: Literal["open", "closed"] | None = Query(default=None, alias="status"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    q: str | None = Query(default=None),
    order: Literal["asc", "desc"] = Query(default="asc"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> EventListResponse:
    connection = _db(request)
    try:
        clauses = []
        params: list[object] = []
        if status_filter:
            clauses.append("status = ?")
            params.append(status_filter)
        if date_from:
            clauses.append("event_date >= ?")
            params.append(date_from)
        if date_to:
            clauses.append("event_date <= ?")
            params.append(date_to)
        if q:
            clauses.append("(name LIKE ? OR venue LIKE ?)")
            like = f"%{q.strip()}%"
            params.extend([like, like])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        # order is a validated Literal, safe to interpolate directly.
        order_sql = "ASC" if order == "asc" else "DESC"

        total = connection.execute(f"SELECT COUNT(*) FROM events {where}", params).fetchone()[0]
        rows = connection.execute(
            f"SELECT * FROM events {where} ORDER BY event_date {order_sql} LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        return EventListResponse(
            items=[_row_to_event(row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
    finally:
        connection.close()


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, request: Request) -> EventOut:
    connection = _db(request)
    try:
        row = connection.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
        return _row_to_event(row)
    finally:
        connection.close()


@router.post(
    "/{event_id}/participants",
    response_model=ParticipationOut,
    status_code=status.HTTP_201_CREATED,
)
def register_participant(
    event_id: int, body: RegisterParticipantIn, request: Request
) -> ParticipationOut:
    connection = _db(request)
    try:
        event = connection.execute(
            "SELECT status FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if event is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
        if event["status"] == "closed" and body.rsvp_status:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Registration is closed for this event"
            )

        participant = connection.execute(
            "SELECT 1 FROM participants WHERE id = ?", (body.participant_id,)
        ).fetchone()
        if participant is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")

        with connection:
            existing = connection.execute(
                "SELECT id FROM participations WHERE event_id = ? AND participant_id = ?",
                (event_id, body.participant_id),
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
                    (event_id, body.participant_id, int(body.rsvp_status)),
                )
        return ParticipationOut(
            event_id=event_id,
            participant_id=body.participant_id,
            rsvp_status=body.rsvp_status,
            attendance=None,
        )
    finally:
        connection.close()


@router.patch("/{event_id}/participants/{participant_id}", response_model=ParticipationOut)
def update_participation(
    event_id: int, participant_id: int, body: UpdateParticipationIn, request: Request
) -> ParticipationOut:
    connection = _db(request)
    try:
        row = connection.execute(
            "SELECT * FROM participations WHERE event_id = ? AND participant_id = ?",
            (event_id, participant_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Registration not found")

        updates = body.model_dump(exclude_unset=True)
        if not updates:
            return _row_to_participation(row)

        set_clause = ", ".join(f"{key} = ?" for key in updates)
        values = [int(value) if isinstance(value, bool) else value for value in updates.values()]
        with connection:
            connection.execute(
                f"UPDATE participations SET {set_clause} WHERE id = ?",
                [*values, row["id"]],
            )
            updated = connection.execute(
                "SELECT * FROM participations WHERE id = ?", (row["id"],)
            ).fetchone()
        return _row_to_participation(updated)
    finally:
        connection.close()
