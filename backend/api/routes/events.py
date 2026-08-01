"""Minimal read-only events listing.

NOTE FOR THE TEAM: this is a deliberately minimal read model added so the
volunteer-segment UI can pick a real event to show its roster. The full events
domain (create/update/delete, tasks, subtasks per API_ENDPOINTS.md) is owned by
another teammate; when their events router lands, fold these two read endpoints
into it and delete this module.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.api.routes._common import Connection, Pagination, list_envelope

router = APIRouter(tags=["events"])


class EventSummary(BaseModel):
    id: int
    name: str
    venue: str
    event_date: str
    status: str


@router.get("/events", summary="List events (minimal read model)")
def list_events(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    status: Annotated[str | None, Query()] = None,
) -> dict:
    where = ["1 = 1"]
    params: list[object] = []
    if status is not None:
        where.append("status = ?")
        params.append(status)
    clause = " AND ".join(where)

    total = db.execute(
        f"SELECT COUNT(*) FROM events WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT id, name, venue, event_date, status FROM events
        WHERE {clause}
        ORDER BY event_date
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [EventSummary(**dict(row)) for row in rows]
    return list_envelope(items, total, pagination)


@router.get(
    "/events/{event_id}",
    response_model=EventSummary,
    summary="Get one event (minimal read model)",
)
def get_event(event_id: int, db: Connection) -> EventSummary:
    row = db.execute(
        "SELECT id, name, venue, event_date, status FROM events WHERE id = ?",
        (event_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} was not found")
    return EventSummary(**dict(row))
