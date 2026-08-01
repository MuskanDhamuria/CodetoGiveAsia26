"""Event participant rosters (read side).

Only the event-scoped participant listing needed by the volunteer-segment
roster is implemented here. The full participants CRUD from
`backend/API_ENDPOINTS.md` can be added to this module later without conflict.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.api.routes._common import (
    Connection,
    Pagination,
    as_bool,
    list_envelope,
)

router = APIRouter(tags=["participants"])


class ParticipationOut(BaseModel):
    participant_id: int
    name: str
    contact_number: str | None
    email: str | None
    rsvp_status: bool
    attendance: bool | None


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
