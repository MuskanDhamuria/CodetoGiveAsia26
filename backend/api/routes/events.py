"""Organizer-managed scheduled events and their generated workflows."""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.schema.events import (
    EventCreate,
    EventDetail,
    EventReschedule,
    EventSubtaskCreate,
    EventSubtaskOut,
    EventSubtaskUpdate,
    EventSummary,
    EventTaskCreate,
    EventTaskOut,
    EventTaskUpdate,
    EventUpdate,
    SubtaskOrder,
    TaskOrder,
)

router = APIRouter(tags=["events"])


def task_model(db, task) -> EventTaskOut:
    subtasks = db.execute(
        """
        SELECT id, title, position, completed FROM event_subtasks
        WHERE event_task_id = ? ORDER BY position
        """,
        (task["id"],),
    ).fetchall()
    return EventTaskOut(
        id=task["id"],
        team_member_id=task["team_member_id"],
        template_task_id=task["template_task_id"],
        name=task["name"],
        body=task["body"],
        due_at=task["due_at"],
        category=task["category"],
        status=task["status"],
        position=task["position"],
        subtasks=[
            EventSubtaskOut(
                id=row["id"],
                title=row["title"],
                position=row["position"],
                completed=bool(row["completed"]),
            )
            for row in subtasks
        ],
    )


def require_event_task(db, event_id: int, task_id: int):
    task = db.execute(
        "SELECT * FROM event_tasks WHERE id = ? AND event_id = ?",
        (task_id, event_id),
    ).fetchone()
    if task is None:
        raise HTTPException(404, f"Event task {task_id} was not found")
    return task


def event_detail(db, event_id: int) -> EventDetail:
    event = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} was not found")
    task_rows = db.execute(
        "SELECT * FROM event_tasks WHERE event_id = ? ORDER BY position", (event_id,)
    ).fetchall()
    tasks = [task_model(db, task) for task in task_rows]
    return EventDetail(
        id=event["id"],
        event_template_id=event["event_template_id"],
        name=event["name"],
        venue=event["venue"],
        event_date=event["event_date"],
        description=event["description"],
        start_time=event["start_time"],
        end_time=event["end_time"],
        status=event["status"],
        beneficiary_id=event["beneficiary_id"],
        created_at=event["created_at"],
        updated_at=event["updated_at"],
        tasks=tasks,
    )


@router.post("/events", response_model=EventDetail, status_code=201)
def create_event(payload: EventCreate, db: Connection) -> EventDetail:
    template = db.execute(
        "SELECT beneficiary_id, description FROM event_templates WHERE id = ?",
        (payload.event_template_id,),
    ).fetchone()
    if template is None:
        raise HTTPException(404, f"Event template {payload.event_template_id} was not found")
    beneficiary_id = (
        payload.beneficiary_id
        if payload.beneficiary_id is not None
        else template["beneficiary_id"]
    )

    with db:
        event = db.execute(
            """
            INSERT INTO events
                (event_template_id, name, venue, event_date, description,
                 start_time, end_time, beneficiary_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (
                payload.event_template_id,
                payload.name,
                payload.venue,
                payload.event_date.isoformat(),
                payload.description if payload.description is not None else template["description"],
                payload.start_time.isoformat() if payload.start_time else None,
                payload.end_time.isoformat() if payload.end_time else None,
                beneficiary_id,
            ),
        ).fetchone()
        template_tasks = db.execute(
            """
            SELECT * FROM template_tasks
            WHERE event_template_id = ? ORDER BY position
            """,
            (payload.event_template_id,),
        ).fetchall()
        for template_task in template_tasks:
            due_at = (
                payload.event_date + timedelta(days=template_task["relative_due_days"])
            ).isoformat()
            event_task = db.execute(
                """
                INSERT INTO event_tasks
                    (event_id, template_task_id, name, body, due_at,
                     category, position)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (
                    event["id"],
                    template_task["id"],
                    template_task["name"],
                    template_task["body"],
                    due_at,
                    template_task["category"],
                    template_task["position"],
                ),
            ).fetchone()
            db.execute(
                """
                INSERT INTO event_subtasks (event_task_id, title, position)
                SELECT ?, title, position FROM template_subtasks
                WHERE template_task_id = ?
                """,
                (event_task["id"], template_task["id"]),
            )
    return event_detail(db, event["id"])


@router.get("/events", summary="List events (minimal read model)")
def list_events(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    status: Annotated[str | None, Query()] = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    template_id: Annotated[int | None, Query()] = None,
    beneficiary_id: Annotated[int | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    sort: Annotated[Literal["event_date", "name", "created_at"], Query()] = "event_date",
    order: Annotated[Literal["asc", "desc"], Query()] = "asc",
) -> dict:
    where = ["1 = 1"]
    params: list[object] = []
    if status is not None:
        where.append("status = ?")
        params.append(status)
    if date_from is not None:
        where.append("event_date >= ?")
        params.append(date_from.isoformat())
    if date_to is not None:
        where.append("event_date <= ?")
        params.append(date_to.isoformat())
    if template_id is not None:
        where.append("event_template_id = ?")
        params.append(template_id)
    if beneficiary_id is not None:
        where.append("beneficiary_id = ?")
        params.append(beneficiary_id)
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        where.append("(name LIKE ? OR venue LIKE ?)")
        params.extend([term, term])
    clause = " AND ".join(where)

    total = db.execute(
        f"SELECT COUNT(*) FROM events WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT id, name, venue, event_date, description, start_time, end_time,
               status, beneficiary_id FROM events
        WHERE {clause}
        ORDER BY {sort} {order.upper()}
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [EventSummary(**dict(row)) for row in rows]
    return list_envelope(items, total, pagination)


@router.get(
    "/events/{event_id}",
    response_model=EventDetail,
    summary="Get one event and its workflow",
)
def get_event(event_id: int, db: Connection) -> EventDetail:
    return event_detail(db, event_id)


@router.patch("/events/{event_id}", response_model=EventDetail)
def update_event(event_id: int, payload: EventUpdate, db: Connection) -> EventDetail:
    event_detail(db, event_id)
    values = payload.model_dump(exclude_unset=True)
    if "event_date" in values and values["event_date"] is not None:
        values["event_date"] = values["event_date"].isoformat()
    for field in ("start_time", "end_time"):
        if field in values and values[field] is not None:
            values[field] = values[field].isoformat()
    if values:
        assignments = ", ".join(f"{field} = ?" for field in values)
        db.execute(
            f"UPDATE events SET {assignments} WHERE id = ?",
            [*values.values(), event_id],
        )
        db.commit()
    return event_detail(db, event_id)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Connection) -> Response:
    event_detail(db, event_id)
    db.execute("DELETE FROM events WHERE id = ?", (event_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/events/{event_id}/tasks")
def list_event_tasks(
    event_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    category: Annotated[str | None, Query()] = None,
    task_status: Annotated[str | None, Query(alias="status")] = None,
    team_member_id: Annotated[int | None, Query()] = None,
    due_before: Annotated[str | None, Query()] = None,
    due_after: Annotated[str | None, Query()] = None,
) -> dict:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    where = ["event_id = ?"]
    params: list[object] = [event_id]
    for field, value in (
        ("category", category),
        ("status", task_status),
        ("team_member_id", team_member_id),
    ):
        if value is not None:
            where.append(f"{field} = ?")
            params.append(value)
    if due_before is not None:
        where.append("due_at <= ?")
        params.append(due_before)
    if due_after is not None:
        where.append("due_at >= ?")
        params.append(due_after)
    clause = " AND ".join(where)
    total = db.execute(
        f"SELECT COUNT(*) FROM event_tasks WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM event_tasks WHERE {clause}
        ORDER BY position LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope([task_model(db, row) for row in rows], total, pagination)


@router.post(
    "/events/{event_id}/tasks",
    response_model=EventTaskOut,
    status_code=status.HTTP_201_CREATED,
)
def create_event_task(
    event_id: int, payload: EventTaskCreate, db: Connection
) -> EventTaskOut:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    if payload.team_member_id is not None:
        member = db.execute(
            "SELECT is_active FROM team_members WHERE id = ?", (payload.team_member_id,)
        ).fetchone()
        if member is None:
            raise HTTPException(404, f"Team member {payload.team_member_id} was not found")
        if not member["is_active"]:
            raise HTTPException(409, "Inactive team members cannot be assigned tasks")
    position = payload.position
    if position is None:
        position = db.execute(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM event_tasks WHERE event_id = ?",
            (event_id,),
        ).fetchone()[0]
    try:
        row = db.execute(
            """
            INSERT INTO event_tasks
                (event_id, team_member_id, name, body, due_at,
                 category, status, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
            """,
            (
                event_id,
                payload.team_member_id,
                payload.name,
                payload.body,
                payload.due_at.isoformat(),
                payload.category,
                payload.status,
                position,
            ),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Task position is already in use") from error
    return task_model(db, row)


@router.get("/events/{event_id}/tasks/{task_id}", response_model=EventTaskOut)
def get_event_task(event_id: int, task_id: int, db: Connection) -> EventTaskOut:
    return task_model(db, require_event_task(db, event_id, task_id))


@router.delete(
    "/events/{event_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_event_task(event_id: int, task_id: int, db: Connection) -> Response:
    require_event_task(db, event_id, task_id)
    db.execute("DELETE FROM event_tasks WHERE id = ?", (task_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/events/{event_id}/tasks/order", response_model=list[EventTaskOut])
def reorder_event_tasks(
    event_id: int, payload: TaskOrder, db: Connection
) -> list[EventTaskOut]:
    current_rows = db.execute(
        "SELECT id FROM event_tasks WHERE event_id = ? ORDER BY position", (event_id,)
    ).fetchall()
    current_ids = [row["id"] for row in current_rows]
    if not current_ids:
        if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
            raise HTTPException(404, f"Event {event_id} was not found")
    if len(payload.task_ids) != len(set(payload.task_ids)) or set(
        payload.task_ids
    ) != set(current_ids):
        raise HTTPException(400, "task_ids must contain every event task exactly once")
    temporary_offset = len(current_ids) + (
        db.execute(
            "SELECT COALESCE(MAX(position), 0) FROM event_tasks WHERE event_id = ?",
            (event_id,),
        ).fetchone()[0]
    )
    with db:
        db.execute(
            "UPDATE event_tasks SET position = position + ? WHERE event_id = ?",
            (temporary_offset, event_id),
        )
        for position, task_id in enumerate(payload.task_ids):
            db.execute(
                "UPDATE event_tasks SET position = ? WHERE id = ?",
                (position, task_id),
            )
    return [
        task_model(db, require_event_task(db, event_id, task_id))
        for task_id in payload.task_ids
    ]


@router.patch("/events/{event_id}/tasks/{task_id}", response_model=EventTaskOut)
def update_event_task(
    event_id: int, task_id: int, payload: EventTaskUpdate, db: Connection
) -> EventTaskOut:
    current = require_event_task(db, event_id, task_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return task_model(db, current)
    if "team_member_id" in values and values["team_member_id"] is not None:
        member = db.execute(
            "SELECT is_active FROM team_members WHERE id = ?",
            (values["team_member_id"],),
        ).fetchone()
        if member is None:
            raise HTTPException(404, f"Team member {values['team_member_id']} was not found")
        if not member["is_active"]:
            raise HTTPException(409, "Inactive team members cannot be assigned tasks")
    if "due_at" in values and values["due_at"] is not None:
        values["due_at"] = values["due_at"].isoformat()
    assignments = ", ".join(f"{field} = ?" for field in values)
    try:
        row = db.execute(
            f"UPDATE event_tasks SET {assignments} WHERE id = ? RETURNING *",
            [*values.values(), task_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Task position is already in use") from error
    return task_model(db, row)


@router.post("/events/{event_id}/reschedule", response_model=EventDetail)
def reschedule_event(
    event_id: int, payload: EventReschedule, db: Connection
) -> EventDetail:
    event = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    old_date = date.fromisoformat(event["event_date"])
    day_shift = (payload.event_date - old_date).days
    with db:
        db.execute(
            "UPDATE events SET event_date = ? WHERE id = ?",
            (payload.event_date.isoformat(), event_id),
        )
        if payload.shift_task_deadlines and day_shift:
            modifier = f"{day_shift:+d} days"
            db.execute(
                "UPDATE event_tasks SET due_at = date(due_at, ?) WHERE event_id = ?",
                (modifier, event_id),
            )
    return event_detail(db, event_id)


def set_task_status(
    event_id: int, task_id: int, task_status: str, db
) -> EventTaskOut:
    require_event_task(db, event_id, task_id)
    task = db.execute(
        "UPDATE event_tasks SET status = ? WHERE id = ? RETURNING *",
        (task_status, task_id),
    ).fetchone()
    db.commit()
    return task_model(db, task)


@router.post("/events/{event_id}/tasks/{task_id}/start", response_model=EventTaskOut)
def start_task(event_id: int, task_id: int, db: Connection) -> EventTaskOut:
    return set_task_status(event_id, task_id, "ongoing", db)


@router.post(
    "/events/{event_id}/tasks/{task_id}/complete", response_model=EventTaskOut
)
def complete_task(event_id: int, task_id: int, db: Connection) -> EventTaskOut:
    return set_task_status(event_id, task_id, "done", db)


@router.post("/events/{event_id}/tasks/{task_id}/reopen", response_model=EventTaskOut)
def reopen_task(event_id: int, task_id: int, db: Connection) -> EventTaskOut:
    return set_task_status(event_id, task_id, "incomplete", db)


@router.post(
    "/events/{event_id}/tasks/{task_id}/subtasks",
    response_model=EventSubtaskOut,
    status_code=status.HTTP_201_CREATED,
)
def create_event_subtask(
    event_id: int,
    task_id: int,
    payload: EventSubtaskCreate,
    db: Connection,
) -> EventSubtaskOut:
    require_event_task(db, event_id, task_id)
    position = payload.position
    if position is None:
        position = db.execute(
            """
            SELECT COALESCE(MAX(position) + 1, 0) FROM event_subtasks
            WHERE event_task_id = ?
            """,
            (task_id,),
        ).fetchone()[0]
    try:
        row = db.execute(
            """
            INSERT INTO event_subtasks (event_task_id, title, position)
            VALUES (?, ?, ?) RETURNING *
            """,
            (task_id, payload.title, position),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Subtask position is already in use") from error
    return EventSubtaskOut(
        id=row["id"],
        title=row["title"],
        position=row["position"],
        completed=bool(row["completed"]),
    )


@router.patch(
    "/events/{event_id}/tasks/{task_id}/subtasks/{subtask_id}",
    response_model=EventSubtaskOut,
)
def update_event_subtask(
    event_id: int,
    task_id: int,
    subtask_id: int,
    payload: EventSubtaskUpdate,
    db: Connection,
) -> EventSubtaskOut:
    require_event_task(db, event_id, task_id)
    current = db.execute(
        """
        SELECT * FROM event_subtasks
        WHERE id = ? AND event_task_id = ?
        """,
        (subtask_id, task_id),
    ).fetchone()
    if current is None:
        raise HTTPException(404, f"Event subtask {subtask_id} was not found")
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return EventSubtaskOut(
            id=current["id"],
            title=current["title"],
            position=current["position"],
            completed=bool(current["completed"]),
        )
    assignments = ", ".join(f"{field} = ?" for field in values)
    params = [int(value) if isinstance(value, bool) else value for value in values.values()]
    try:
        row = db.execute(
            f"UPDATE event_subtasks SET {assignments} WHERE id = ? RETURNING *",
            [*params, subtask_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Subtask position is already in use") from error
    return EventSubtaskOut(
        id=row["id"],
        title=row["title"],
        position=row["position"],
        completed=bool(row["completed"]),
    )


@router.delete(
    "/events/{event_id}/tasks/{task_id}/subtasks/{subtask_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_event_subtask(
    event_id: int, task_id: int, subtask_id: int, db: Connection
) -> Response:
    require_event_task(db, event_id, task_id)
    row = db.execute(
        """
        DELETE FROM event_subtasks
        WHERE id = ? AND event_task_id = ? RETURNING id
        """,
        (subtask_id, task_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Event subtask {subtask_id} was not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/events/{event_id}/tasks/{task_id}/subtasks/order",
    response_model=list[EventSubtaskOut],
)
def reorder_event_subtasks(
    event_id: int,
    task_id: int,
    payload: SubtaskOrder,
    db: Connection,
) -> list[EventSubtaskOut]:
    require_event_task(db, event_id, task_id)
    rows = db.execute(
        "SELECT id FROM event_subtasks WHERE event_task_id = ?", (task_id,)
    ).fetchall()
    current_ids = [row["id"] for row in rows]
    if len(payload.subtask_ids) != len(set(payload.subtask_ids)) or set(
        payload.subtask_ids
    ) != set(current_ids):
        raise HTTPException(400, "subtask_ids must contain every event subtask exactly once")
    maximum = db.execute(
        "SELECT COALESCE(MAX(position), 0) FROM event_subtasks WHERE event_task_id = ?",
        (task_id,),
    ).fetchone()[0]
    with db:
        db.execute(
            """
            UPDATE event_subtasks SET position = position + ?
            WHERE event_task_id = ?
            """,
            (maximum + len(current_ids), task_id),
        )
        for position, subtask_id in enumerate(payload.subtask_ids):
            db.execute(
                "UPDATE event_subtasks SET position = ? WHERE id = ?",
                (position, subtask_id),
            )
    ordered_rows = db.execute(
        """
        SELECT * FROM event_subtasks WHERE event_task_id = ? ORDER BY position
        """,
        (task_id,),
    ).fetchall()
    return [
        EventSubtaskOut(
            id=row["id"],
            title=row["title"],
            position=row["position"],
            completed=bool(row["completed"]),
        )
        for row in ordered_rows
    ]


def set_event_status(event_id: int, event_status: str, db) -> EventDetail:
    row = db.execute(
        "UPDATE events SET status = ? WHERE id = ? RETURNING id",
        (event_status, event_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    db.commit()
    return event_detail(db, event_id)


@router.post("/events/{event_id}/close", response_model=EventDetail)
def close_event(event_id: int, db: Connection) -> EventDetail:
    return set_event_status(event_id, "closed", db)


@router.post("/events/{event_id}/reopen", response_model=EventDetail)
def reopen_event(event_id: int, db: Connection) -> EventDetail:
    return set_event_status(event_id, "open", db)
