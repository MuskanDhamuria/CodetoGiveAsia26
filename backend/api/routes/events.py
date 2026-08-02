"""Organizer-managed scheduled events and their generated workflows."""

from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.api.routes.event_organizers import (
    ensure_team_member_event_organizer,
    require_approved_event_volunteer,
)
from backend.attendance_qr import PARTICIPANT_KIND, VOLUNTEER_KIND, parse_token
from backend.schema.events import (
    EventCreate,
    EventDetail,
    EventReschedule,
    EventSubtaskCreate,
    EventSubtaskOut,
    EventSubtaskTimeLogCreate,
    EventSubtaskTimeLogOut,
    EventSubtaskUpdate,
    EventSummary,
    EventTaskCreate,
    EventTaskAssigneeInput,
    EventTaskAssigneeOut,
    EventTaskOut,
    EventTaskUpdate,
    EventUpdate,
    SubtaskOrder,
    TaskOrder,
)

router = APIRouter(tags=["events"])


def subtask_model(db, subtask) -> EventSubtaskOut:
    assignee_rows = db.execute(
        """
        SELECT assignees.team_member_id, assignees.volunteer_id,
               COALESCE(team_members.name, volunteers.name) AS name,
               COALESCE(team_members.email, volunteers.email) AS email
        FROM event_subtask_assignees AS assignees
        LEFT JOIN team_members ON team_members.id = assignees.team_member_id
        LEFT JOIN volunteers ON volunteers.id = assignees.volunteer_id
        WHERE assignees.event_subtask_id = ?
        ORDER BY name
        """,
        (subtask["id"],),
    ).fetchall()
    time_log_rows = db.execute(
        """
        SELECT logs.id, logs.team_member_id, logs.volunteer_id,
               logs.minutes_spent, logs.notes, logs.logged_at,
               COALESCE(team_members.name, volunteers.name) AS name
        FROM event_subtask_time_logs AS logs
        LEFT JOIN team_members ON team_members.id = logs.team_member_id
        LEFT JOIN volunteers ON volunteers.id = logs.volunteer_id
        WHERE logs.event_subtask_id = ?
        ORDER BY logs.logged_at DESC, logs.id DESC
        """,
        (subtask["id"],),
    ).fetchall()
    return EventSubtaskOut(
        id=subtask["id"],
        title=subtask["title"],
        position=subtask["position"],
        completed=bool(subtask["completed"]),
        scheduled_start=subtask["scheduled_start"],
        scheduled_end=subtask["scheduled_end"],
        estimated_minutes=subtask["estimated_minutes"],
        assignees=[
            EventTaskAssigneeOut(
                person_type="team_member" if row["team_member_id"] is not None else "volunteer",
                person_id=row["team_member_id"] if row["team_member_id"] is not None else row["volunteer_id"],
                name=row["name"],
                email=row["email"],
                is_lead=False,
            )
            for row in assignee_rows
        ],
        time_logs=[
            EventSubtaskTimeLogOut(
                id=row["id"],
                person_type="team_member" if row["team_member_id"] is not None else "volunteer",
                person_id=row["team_member_id"] if row["team_member_id"] is not None else row["volunteer_id"],
                name=row["name"],
                minutes_spent=row["minutes_spent"],
                notes=row["notes"],
                logged_at=row["logged_at"],
            )
            for row in time_log_rows
        ],
    )


def task_model(db, task) -> EventTaskOut:
    subtasks = db.execute(
        """
        SELECT * FROM event_subtasks
        WHERE event_task_id = ? ORDER BY position
        """,
        (task["id"],),
    ).fetchall()
    assignee_rows = db.execute(
        """
        SELECT assignees.team_member_id, assignees.volunteer_id, assignees.is_lead,
               COALESCE(team_members.name, volunteers.name) AS name,
               COALESCE(team_members.email, volunteers.email) AS email
        FROM event_task_assignees AS assignees
        LEFT JOIN team_members ON team_members.id = assignees.team_member_id
        LEFT JOIN volunteers ON volunteers.id = assignees.volunteer_id
        WHERE assignees.event_task_id = ?
        ORDER BY assignees.is_lead DESC, name
        """,
        (task["id"],),
    ).fetchall()
    return EventTaskOut(
        id=task["id"],
        team_member_id=task["team_member_id"],
        volunteer_id=task["volunteer_id"],
        template_task_id=task["template_task_id"],
        name=task["name"],
        body=task["body"],
        due_at=task["due_at"],
        category=task["category"],
        status=task["status"],
        position=task["position"],
        assignees=[
            EventTaskAssigneeOut(
                person_type="team_member" if row["team_member_id"] is not None else "volunteer",
                person_id=row["team_member_id"] if row["team_member_id"] is not None else row["volunteer_id"],
                name=row["name"],
                email=row["email"],
                is_lead=bool(row["is_lead"]),
            )
            for row in assignee_rows
        ],
        subtasks=[subtask_model(db, row) for row in subtasks],
    )


def require_event_task(db, event_id: int, task_id: int):
    task = db.execute(
        "SELECT * FROM event_tasks WHERE id = ? AND event_id = ?",
        (task_id, event_id),
    ).fetchone()
    if task is None:
        raise HTTPException(404, f"Event task {task_id} was not found")
    return task


def require_event_subtask(db, event_id: int, task_id: int, subtask_id: int):
    require_event_task(db, event_id, task_id)
    subtask = db.execute(
        "SELECT * FROM event_subtasks WHERE id = ? AND event_task_id = ?",
        (subtask_id, task_id),
    ).fetchone()
    if subtask is None:
        raise HTTPException(404, f"Event subtask {subtask_id} was not found")
    return subtask


def validate_task_assignee(
    db: sqlite3.Connection,
    event_id: int,
    team_member_id: int | None,
    volunteer_id: int | None,
) -> None:
    if team_member_id is not None and volunteer_id is not None:
        raise HTTPException(400, "A task can have only one assignee")
    if team_member_id is not None:
        ensure_team_member_event_organizer(db, event_id, team_member_id)
    if volunteer_id is not None:
        require_approved_event_volunteer(db, event_id, volunteer_id)


def replace_task_assignees(db, event_id: int, task_id: int, assignees) -> None:
    seen: set[tuple[str, int]] = set()
    for assignee in assignees:
        key = (assignee.person_type, assignee.person_id)
        if key in seen:
            raise HTTPException(400, "A person can be assigned to a task only once")
        seen.add(key)
        if assignee.person_type == "team_member":
            ensure_team_member_event_organizer(db, event_id, assignee.person_id)
        else:
            require_approved_event_volunteer(db, event_id, assignee.person_id)

    db.execute("DELETE FROM event_task_assignees WHERE event_task_id = ?", (task_id,))
    for assignee in assignees:
        db.execute(
            """
            INSERT INTO event_task_assignees
                (event_task_id, team_member_id, volunteer_id, is_lead)
            VALUES (?, ?, ?, ?)
            """,
            (
                task_id,
                assignee.person_id if assignee.person_type == "team_member" else None,
                assignee.person_id if assignee.person_type == "volunteer" else None,
                1 if assignee.is_lead else 0,
            ),
        )

    first = assignees[0] if assignees else None
    db.execute(
        "UPDATE event_tasks SET team_member_id = ?, volunteer_id = ? WHERE id = ?",
        (
            first.person_id if first and first.person_type == "team_member" else None,
            first.person_id if first and first.person_type == "volunteer" else None,
            task_id,
        ),
    )


def replace_subtask_assignees(db, event_id: int, subtask_id: int, assignees) -> None:
    seen: set[tuple[str, int]] = set()
    for assignee in assignees:
        key = (assignee.person_type, assignee.person_id)
        if key in seen:
            raise HTTPException(400, "A person can be assigned to a subtask only once")
        seen.add(key)
        if assignee.person_type == "team_member":
            ensure_team_member_event_organizer(db, event_id, assignee.person_id)
        else:
            require_approved_event_volunteer(db, event_id, assignee.person_id)

    db.execute(
        "DELETE FROM event_subtask_assignees WHERE event_subtask_id = ?",
        (subtask_id,),
    )
    for assignee in assignees:
        db.execute(
            """
            INSERT INTO event_subtask_assignees
                (event_subtask_id, team_member_id, volunteer_id)
            VALUES (?, ?, ?)
            """,
            (
                subtask_id,
                assignee.person_id if assignee.person_type == "team_member" else None,
                assignee.person_id if assignee.person_type == "volunteer" else None,
            ),
        )


def validate_subtask_work_fields(
    scheduled_start: str | None,
    scheduled_end: str | None,
    estimated_minutes: int | None,
) -> None:
    if (scheduled_start is None) != (scheduled_end is None):
        raise HTTPException(400, "Scheduled subtasks require both a start and end time")
    if scheduled_start is not None and scheduled_end is not None:
        if datetime.fromisoformat(scheduled_end) <= datetime.fromisoformat(scheduled_start):
            raise HTTPException(400, "Subtask end time must be after its start time")
        if estimated_minutes is not None:
            raise HTTPException(400, "A subtask cannot be both scheduled and effort-based")


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
        event_time=event["start_time"],
        status=event["status"],
        beneficiary_id=event["beneficiary_id"],
        expected_attendance=event["expected_attendance"],
        is_cancelled=event["cancelled_at"] is not None,
        created_at=event["created_at"],
        updated_at=event["updated_at"],
        tasks=tasks,
    )


def resolve_event_template_context(db, payload: EventCreate) -> tuple[int | None, str]:
    """Look up the payload's template (if any) and resolve inherited fields.

    Shared by ``create_event`` and the AI ``create_event_draft`` tool
    (backend/ai_tools) so draft validation can reuse the exact same
    template-existence check and default-inheritance rules without a DB
    write, instead of re-implementing them.
    """

    template = None
    if payload.event_template_id is not None:
        template = db.execute(
            """
            SELECT beneficiary_id, description FROM event_templates WHERE id = ?
            """,
            (payload.event_template_id,),
        ).fetchone()
        if template is None:
            raise HTTPException(
                404, f"Event template {payload.event_template_id} was not found"
            )

    beneficiary_id = (
        payload.beneficiary_id
        if payload.beneficiary_id is not None
        else template["beneficiary_id"] if template is not None else None
    )
    description = (
        payload.description
        if payload.description is not None
        else template["description"] if template is not None else ""
    )
    return beneficiary_id, description


@router.post("/events", response_model=EventDetail, status_code=201)
def create_event(payload: EventCreate, db: Connection) -> EventDetail:
    beneficiary_id, description = resolve_event_template_context(db, payload)

    with db:
        event = db.execute(
            """
            INSERT INTO events
                (event_template_id, name, venue, event_date, description,
                start_time, end_time, beneficiary_id, expected_attendance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (
                payload.event_template_id,
                payload.name,
                payload.venue,
                payload.event_date.isoformat(),
                description,
                payload.start_time.isoformat() if payload.start_time else None,
                payload.end_time.isoformat() if payload.end_time else None,
                beneficiary_id,
                payload.expected_attendance,
            ),
        ).fetchone()
        template_tasks = (
            db.execute(
                """
                SELECT * FROM template_tasks
                WHERE event_template_id = ? ORDER BY position
                """,
                (payload.event_template_id,),
            ).fetchall()
            if payload.event_template_id is not None
            else []
        )
        if payload.event_template_id is not None:
            db.execute(
                """
                INSERT INTO event_roles (event_id, role_id)
                SELECT ?, role_id FROM template_roles
                WHERE event_template_id = ?
                """,
                (event["id"], payload.event_template_id),
            )
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
        template_requirements = (
            db.execute(
                """SELECT * FROM template_logistics_requirements
                   WHERE event_template_id = ? ORDER BY id""",
                (payload.event_template_id,),
            ).fetchall()
            if payload.event_template_id is not None
            else []
        )
        attendance = payload.expected_attendance or 0
        for requirement in template_requirements:
            required_quantity = math.ceil(
                (float(requirement["base_quantity"])
                 + float(requirement["quantity_per_person"]) * attendance)
                * (1 + float(requirement["buffer_percentage"]) / 100)
            )
            needed_by = (
                payload.event_date + timedelta(days=requirement["relative_needed_day"])
            ).isoformat()
            db.execute(
                """INSERT INTO event_logistics_requirements
                   (event_id, template_requirement_id, requirement_type,
                    inventory_item_id, service_name, base_quantity,
                    quantity_per_person, buffer_percentage,
                    expected_attendance_snapshot, required_quantity, unit,
                    needed_by, priority, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (event["id"], requirement["id"], requirement["requirement_type"],
                 requirement["inventory_item_id"], requirement["service_name"],
                 requirement["base_quantity"], requirement["quantity_per_person"],
                 requirement["buffer_percentage"], payload.expected_attendance,
                 required_quantity, requirement["unit"], needed_by,
                 requirement["priority"], requirement["notes"]),
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
               status, beneficiary_id, expected_attendance, cancelled_at FROM events
        WHERE {clause}
        ORDER BY {sort} {order.upper()}
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [
        EventSummary(
            **{k: v for k, v in dict(row).items() if k != "cancelled_at"},
            event_time=row["start_time"],
            is_cancelled=row["cancelled_at"] is not None,
        )
        for row in rows
    ]
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
    volunteer_id: Annotated[int | None, Query()] = None,
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
    ):
        if value is not None:
            where.append(f"{field} = ?")
            params.append(value)
    if team_member_id is not None:
        where.append(
            "EXISTS (SELECT 1 FROM event_task_assignees WHERE event_task_id = event_tasks.id AND team_member_id = ?)"
        )
        params.append(team_member_id)
    if volunteer_id is not None:
        where.append(
            "EXISTS (SELECT 1 FROM event_task_assignees WHERE event_task_id = event_tasks.id AND volunteer_id = ?)"
        )
        params.append(volunteer_id)
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
    requested_assignees = payload.assignees
    if not requested_assignees and (payload.team_member_id is not None or payload.volunteer_id is not None):
        requested_assignees = [EventTaskAssigneeInput(
            person_type="team_member" if payload.team_member_id is not None else "volunteer",
            person_id=payload.team_member_id if payload.team_member_id is not None else payload.volunteer_id,
        )]
    first_assignee = requested_assignees[0] if requested_assignees else None
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
                (event_id, team_member_id, volunteer_id, name, body, due_at,
                 category, status, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
            """,
            (
                event_id,
                first_assignee.person_id if first_assignee and first_assignee.person_type == "team_member" else None,
                first_assignee.person_id if first_assignee and first_assignee.person_type == "volunteer" else None,
                payload.name,
                payload.body,
                payload.due_at.isoformat(),
                payload.category,
                payload.status,
                position,
            ),
        ).fetchone()
        replace_task_assignees(db, event_id, row["id"], requested_assignees)
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
    assignees_changed = "assignees" in payload.model_fields_set
    requested_assignees = payload.assignees if assignees_changed else None
    values.pop("assignees", None)
    if not values and not assignees_changed:
        return task_model(db, current)
    assignee_changed = "team_member_id" in values or "volunteer_id" in values
    if assignee_changed:
        if "team_member_id" not in values:
            values["team_member_id"] = None
        if "volunteer_id" not in values:
            values["volunteer_id"] = None
        validate_task_assignee(
            db, event_id, values["team_member_id"], values["volunteer_id"]
        )
    if "due_at" in values and values["due_at"] is not None:
        values["due_at"] = values["due_at"].isoformat()
    try:
        if values:
            assignments = ", ".join(f"{field} = ?" for field in values)
            row = db.execute(
                f"UPDATE event_tasks SET {assignments} WHERE id = ? RETURNING *",
                [*values.values(), task_id],
            ).fetchone()
        else:
            row = current
        if assignees_changed:
            replace_task_assignees(db, event_id, task_id, requested_assignees or [])
            row = require_event_task(db, event_id, task_id)
        elif assignee_changed:
            legacy_assignees = []
            if values["team_member_id"] is not None or values["volunteer_id"] is not None:
                legacy_assignees = [EventTaskAssigneeInput(
                    person_type="team_member" if values["team_member_id"] is not None else "volunteer",
                    person_id=values["team_member_id"] if values["team_member_id"] is not None else values["volunteer_id"],
                )]
            replace_task_assignees(db, event_id, task_id, legacy_assignees)
            row = require_event_task(db, event_id, task_id)
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
            db.execute(
                """
                UPDATE event_subtasks
                SET scheduled_start = datetime(scheduled_start, ?),
                    scheduled_end = datetime(scheduled_end, ?)
                WHERE scheduled_start IS NOT NULL
                  AND event_task_id IN (
                      SELECT id FROM event_tasks WHERE event_id = ?
                  )
                """,
                (modifier, modifier, event_id),
            )
            db.execute(
                "UPDATE event_logistics_requirements SET needed_by = datetime(needed_by, ?) WHERE event_id = ?",
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
    scheduled_start = payload.scheduled_start.isoformat() if payload.scheduled_start else None
    scheduled_end = payload.scheduled_end.isoformat() if payload.scheduled_end else None
    validate_subtask_work_fields(scheduled_start, scheduled_end, payload.estimated_minutes)
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
            INSERT INTO event_subtasks
                (event_task_id, title, position, scheduled_start, scheduled_end,
                 estimated_minutes)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *
            """,
            (
                task_id,
                payload.title,
                position,
                scheduled_start,
                scheduled_end,
                payload.estimated_minutes,
            ),
        ).fetchone()
        replace_subtask_assignees(db, event_id, row["id"], payload.assignees)
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Subtask position is already in use") from error
    return subtask_model(db, row)


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
    current = require_event_subtask(db, event_id, task_id, subtask_id)
    values = payload.model_dump(exclude_unset=True)
    assignees_changed = "assignees" in payload.model_fields_set
    requested_assignees = payload.assignees if assignees_changed else None
    values.pop("assignees", None)
    if not values and not assignees_changed:
        return subtask_model(db, current)
    for field in ("scheduled_start", "scheduled_end"):
        if field in values and values[field] is not None:
            values[field] = values[field].isoformat()
    work_values = {
        "scheduled_start": values.get("scheduled_start", current["scheduled_start"]),
        "scheduled_end": values.get("scheduled_end", current["scheduled_end"]),
        "estimated_minutes": values.get("estimated_minutes", current["estimated_minutes"]),
    }
    validate_subtask_work_fields(**work_values)
    assignments = ", ".join(f"{field} = ?" for field in values)
    params = [int(value) if isinstance(value, bool) else value for value in values.values()]
    try:
        row = current
        if values:
            row = db.execute(
                f"UPDATE event_subtasks SET {assignments} WHERE id = ? RETURNING *",
                [*params, subtask_id],
            ).fetchone()
        if assignees_changed:
            replace_subtask_assignees(db, event_id, subtask_id, requested_assignees or [])
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Subtask position is already in use") from error
    return subtask_model(db, row)


@router.post(
    "/events/{event_id}/tasks/{task_id}/subtasks/{subtask_id}/time-logs",
    response_model=EventSubtaskTimeLogOut,
    status_code=status.HTTP_201_CREATED,
)
def create_event_subtask_time_log(
    event_id: int,
    task_id: int,
    subtask_id: int,
    payload: EventSubtaskTimeLogCreate,
    db: Connection,
) -> EventSubtaskTimeLogOut:
    subtask = require_event_subtask(db, event_id, task_id, subtask_id)
    if subtask["scheduled_start"] is not None:
        raise HTTPException(400, "Hours can only be logged against effort-based subtasks")
    id_column = "team_member_id" if payload.person_type == "team_member" else "volunteer_id"
    assigned = db.execute(
        f"SELECT 1 FROM event_subtask_assignees WHERE event_subtask_id = ? AND {id_column} = ?",
        (subtask_id, payload.person_id),
    ).fetchone()
    if assigned is None:
        raise HTTPException(400, "Only an assigned person can log time against this subtask")
    row = db.execute(
        """
        INSERT INTO event_subtask_time_logs
            (event_subtask_id, team_member_id, volunteer_id, minutes_spent, notes)
        VALUES (?, ?, ?, ?, ?) RETURNING *
        """,
        (
            subtask_id,
            payload.person_id if payload.person_type == "team_member" else None,
            payload.person_id if payload.person_type == "volunteer" else None,
            payload.minutes_spent,
            payload.notes,
        ),
    ).fetchone()
    db.commit()
    person_table = "team_members" if payload.person_type == "team_member" else "volunteers"
    name = db.execute(
        f"SELECT name FROM {person_table} WHERE id = ?", (payload.person_id,)
    ).fetchone()["name"]
    return EventSubtaskTimeLogOut(
        id=row["id"],
        person_type=payload.person_type,
        person_id=payload.person_id,
        name=name,
        minutes_spent=row["minutes_spent"],
        notes=row["notes"],
        logged_at=row["logged_at"],
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
        subtask_model(db, row)
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
    detail = set_event_status(event_id, "closed", db)
    db.execute(
        """INSERT INTO event_logistics_reconciliations (event_id, status)
           VALUES (?, 'pending')
           ON CONFLICT(event_id) DO UPDATE SET status = 'pending', completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP""",
        (event_id,),
    )
    db.commit()
    return detail


@router.post("/events/{event_id}/reopen", response_model=EventDetail)
def reopen_event(event_id: int, db: Connection) -> EventDetail:
    return set_event_status(event_id, "open", db)


@router.post("/events/{event_id}/cancel", response_model=EventDetail)
def cancel_event(event_id: int, db: Connection) -> EventDetail:
    row = db.execute(
        """
        UPDATE events SET status = 'closed', cancelled_at = CURRENT_TIMESTAMP
        WHERE id = ? RETURNING id
        """,
        (event_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Event {event_id} was not found")
    db.commit()
    return event_detail(db, event_id)


@router.post(
    "/events/{event_id}/attendance/scan",
    summary="Mark attendance from a scanned participant/volunteer QR code",
)
def scan_attendance(event_id: int, payload: dict, db: Connection) -> dict:
    token = payload.get("token") if isinstance(payload, dict) else None
    if not token:
        raise HTTPException(400, "Missing QR token")

    parsed = parse_token(token)
    if parsed is None:
        raise HTTPException(400, "This QR code isn't valid or has been tampered with")
    kind, person_id, token_event_id = parsed
    if token_event_id != event_id:
        raise HTTPException(400, "This QR code is for a different event")

    if kind == PARTICIPANT_KIND:
        person = db.execute(
            "SELECT id, name FROM participants WHERE id = ?", (person_id,)
        ).fetchone()
        if person is None:
            raise HTTPException(404, "Participant not found")
        registration = db.execute(
            "SELECT attendance FROM participations WHERE event_id = ? AND participant_id = ?",
            (event_id, person_id),
        ).fetchone()
        if registration is None:
            raise HTTPException(404, f"{person['name']} isn't registered for this event")
        already_marked = bool(registration["attendance"])
        db.execute(
            "UPDATE participations SET attendance = 1 WHERE event_id = ? AND participant_id = ?",
            (event_id, person_id),
        )
        role = "participant"
    elif kind == VOLUNTEER_KIND:
        person = db.execute(
            "SELECT id, name FROM volunteers WHERE id = ?", (person_id,)
        ).fetchone()
        if person is None:
            raise HTTPException(404, "Volunteer not found")
        registration = db.execute(
            "SELECT attendance FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
            (event_id, person_id),
        ).fetchone()
        if registration is None:
            raise HTTPException(404, f"{person['name']} isn't signed up to volunteer for this event")
        already_marked = bool(registration["attendance"])
        db.execute(
            "UPDATE volunteer_signups SET attendance = 1 WHERE event_id = ? AND volunteer_id = ?",
            (event_id, person_id),
        )
        role = "volunteer"
    else:
        raise HTTPException(400, "Unrecognized QR code")

    db.commit()
    return {
        "name": person["name"],
        "role": role,
        "already_marked": already_marked,
    }
