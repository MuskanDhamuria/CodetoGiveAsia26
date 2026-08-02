"""Organizer-managed participant profiles, RSVPs, and attendance."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.api.routes._common import (
    Connection,
    Pagination,
    as_bool,
    list_envelope,
)
from backend.attendance_qr import PARTICIPANT_KIND, generate_token
from backend.phone import InvalidPhoneNumberError, normalize_phone_number
from backend.schema.participants import (
    ParticipantCreate,
    ParticipantOut,
    ParticipantUpdate,
    ParticipationCreate,
    ParticipationOut,
    ParticipationUpdate,
)

router = APIRouter(tags=["participants"])


def participant_model(row: sqlite3.Row) -> ParticipantOut:
    return ParticipantOut(**dict(row))


def require_participant(db: sqlite3.Connection, participant_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM participants WHERE id = ?", (participant_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Participant {participant_id} was not found")
    return row


def _event_template_id(db: sqlite3.Connection, event_id: int) -> int | None:
    row = db.execute(
        "SELECT event_template_id FROM events WHERE id = ?", (event_id,)
    ).fetchone()
    return row["event_template_id"] if row else None


def _has_repeat_signup(
    db: sqlite3.Connection, template_id: int | None, event_id: int, participant_id: int
) -> bool | None:
    """Has this participant signed up for another event sharing the same

    template? None when the event has no event_template_id, since there's
    no basis for "similar" without one — see docs/tickets.md TICKET-70.
    """

    if template_id is None:
        return None
    row = db.execute(
        """
        SELECT 1 FROM participations pt
        JOIN events e ON e.id = pt.event_id
        WHERE pt.participant_id = ? AND e.event_template_id = ? AND e.id != ?
        LIMIT 1
        """,
        (participant_id, template_id, event_id),
    ).fetchone()
    return row is not None


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
    template_id = _event_template_id(db, event_id)
    return ParticipationOut(
        participant_id=row["participant_id"],
        name=row["name"],
        contact_number=row["contact_number"],
        email=row["email"],
        rsvp_status=bool(row["rsvp_status"]),
        attendance=as_bool(row["attendance"]),
        repeat_signup=_has_repeat_signup(db, template_id, event_id, row["participant_id"]),
    )


def _normalize_contact_number(contact_number: str | None) -> str | None:
    if not contact_number:
        return None
    try:
        return normalize_phone_number(contact_number)
    except InvalidPhoneNumberError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error


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
    contact_number = _normalize_contact_number(payload.contact_number)
    try:
        row = db.execute(
            """
            INSERT INTO participants (name, contact_number, email)
            VALUES (?, ?, ?) RETURNING *
            """,
            (payload.name, contact_number, payload.email),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Participant contact number or email already exists") from error
    return participant_model(row)


@router.get("/participants/lookup", response_model=ParticipantOut)
def lookup_participant(
    db: Connection,
    contact_number: Annotated[str, Query(min_length=1)],
) -> ParticipantOut:
    """Exact, side-effect-free lookup by phone number.

    Registered ahead of `/participants/{participant_id}` — "lookup" would
    otherwise match that route's path pattern first and fail int validation
    with a 422 instead of running this handler. Used to restore a
    participant's local identity ("sign in") on a new device/browser without
    registering them for an event as a side effect.
    """

    normalized = _normalize_contact_number(contact_number)
    row = db.execute(
        "SELECT * FROM participants WHERE contact_number = ?", (normalized,)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
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
    if "contact_number" in values:
        values["contact_number"] = _normalize_contact_number(values["contact_number"])
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
        SELECT e.id, e.name, e.venue, e.description, e.event_date,
               e.start_time, e.end_time, e.status, e.cancelled_at,
               pt.rsvp_status, pt.attendance
        FROM participations pt JOIN events e ON e.id = pt.event_id
        WHERE {clause} ORDER BY e.event_date DESC LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [
        {
            **{k: v for k, v in dict(row).items() if k != "cancelled_at"},
            "event_time": row["start_time"],
            "is_cancelled": row["cancelled_at"] is not None,
            "rsvp_status": bool(row["rsvp_status"]),
            "attendance": as_bool(row["attendance"]),
        }
        for row in rows
    ]
    return list_envelope(items, total, pagination)


@router.get("/participants/{participant_id}/events/{event_id}/qr-token")
def get_participant_attendance_qr_token(
    participant_id: int, event_id: int, db: Connection
) -> dict:
    require_participant(db, participant_id)
    registered = db.execute(
        "SELECT 1 FROM participations WHERE event_id = ? AND participant_id = ?",
        (event_id, participant_id),
    ).fetchone()
    if registered is None:
        raise HTTPException(404, "This participant isn't registered for that event")
    return {"token": generate_token(PARTICIPANT_KIND, participant_id, event_id)}


@router.get("/participants/{participant_id}/events/{event_id}/certificate")
def get_participant_certificate(participant_id: int, event_id: int, db: Connection) -> dict:
    """The participant's own certificate link for one event, if one has been

    issued (admin generates certificates in bulk per event — see
    whatsapp.py's generate_certificates). Scoped to this participant/event
    pair rather than exposing the admin-only list-all-certificates route to
    the portal. See docs/tickets.md TICKET-46.
    """
    from backend.bot.commands import certificate_link

    require_participant(db, participant_id)
    row = db.execute(
        "SELECT download_token FROM certificates WHERE event_id = ? AND participant_id = ?",
        (event_id, participant_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "No certificate has been issued for this participant yet")
    return {"link": certificate_link(row["download_token"])}


@router.post(
    "/events/{event_id}/participants",
    response_model=ParticipationOut,
    status_code=status.HTTP_201_CREATED,
)
def register_participant(
    event_id: int, payload: ParticipationCreate, db: Connection
) -> ParticipationOut:
    event = db.execute("SELECT status FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    if event["status"] == "closed" and payload.rsvp_status:
        raise HTTPException(409, "Registration is closed for this event")
    require_participant(db, payload.participant_id)

    # Upsert: re-registering after a cancelled RSVP (rsvp_status set to
    # false via PATCH) must revive the same row rather than conflict with
    # the (event_id, participant_id) unique constraint.
    existing = db.execute(
        "SELECT id FROM participations WHERE event_id = ? AND participant_id = ?",
        (event_id, payload.participant_id),
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE participations SET rsvp_status = ? WHERE id = ?",
            (int(payload.rsvp_status), existing["id"]),
        )
    else:
        db.execute(
            """
            INSERT INTO participations (event_id, participant_id, rsvp_status)
            VALUES (?, ?, ?)
            """,
            (event_id, payload.participant_id, int(payload.rsvp_status)),
        )
    db.commit()
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

    template_id = _event_template_id(db, event_id)
    repeat_participant_ids: set[int] = set()
    if template_id is not None and rows:
        repeat_rows = db.execute(
            f"""
            SELECT DISTINCT pt.participant_id FROM participations pt
            JOIN events e ON e.id = pt.event_id
            WHERE e.event_template_id = ? AND e.id != ?
            AND pt.participant_id IN ({",".join("?" for _ in rows)})
            """,
            [template_id, event_id, *(row["participant_id"] for row in rows)],
        ).fetchall()
        repeat_participant_ids = {row["participant_id"] for row in repeat_rows}

    items = [
        ParticipationOut(
            participant_id=row["participant_id"],
            name=row["name"],
            contact_number=row["contact_number"],
            email=row["email"],
            rsvp_status=bool(row["rsvp_status"]),
            attendance=as_bool(row["attendance"]),
            repeat_signup=row["participant_id"] in repeat_participant_ids
            if template_id is not None
            else None,
        )
        for row in rows
    ]
    return list_envelope(items, total, pagination)
