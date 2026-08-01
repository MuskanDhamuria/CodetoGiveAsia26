"""Organizer-managed reusable event workflows."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.schema.common import TaskCategory
from backend.schema.event_templates import (
    SubtaskOrder,
    TaskOrder,
    TemplateClone,
    TemplateCreate,
    TemplateDetail,
    TemplateOut,
    TemplateRoleOut,
    TemplateSubtaskCreate,
    TemplateSubtaskOut,
    TemplateSubtaskUpdate,
    TemplateTaskCreate,
    TemplateTaskDetail,
    TemplateTaskOut,
    TemplateTaskUpdate,
    TemplateUpdate,
)


router = APIRouter(prefix="/event-templates", tags=["event templates"])


def require_template(db: sqlite3.Connection, template_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM event_templates WHERE id = ?", (template_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Event template {template_id} was not found")
    return row


def require_template_task(
    db: sqlite3.Connection, template_id: int, task_id: int
) -> sqlite3.Row:
    row = db.execute(
        """
        SELECT * FROM template_tasks
        WHERE id = ? AND event_template_id = ?
        """,
        (task_id, template_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Template task {task_id} was not found")
    return row


def template_model(row: sqlite3.Row) -> TemplateOut:
    return TemplateOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        is_built_in=bool(row["is_built_in"]),
        beneficiary_id=row["beneficiary_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("")
def list_templates(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    is_built_in: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    where = ["1 = 1"]
    params: list[object] = []
    if is_built_in is not None:
        where.append("is_built_in = ?")
        params.append(int(is_built_in))
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        where.append("(name LIKE ? OR description LIKE ?)")
        params.extend([term, term])
    clause = " AND ".join(where)
    total = db.execute(
        f"SELECT COUNT(*) FROM event_templates WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM event_templates WHERE {clause}
        ORDER BY is_built_in DESC, name
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope([template_model(row) for row in rows], total, pagination)


@router.get("/{template_id}", response_model=TemplateDetail)
def get_template(template_id: int, db: Connection) -> TemplateDetail:
    template = require_template(db, template_id)
    task_rows = db.execute(
        """
        SELECT * FROM template_tasks
        WHERE event_template_id = ? ORDER BY position
        """,
        (template_id,),
    ).fetchall()
    tasks = []
    for task in task_rows:
        subtasks = db.execute(
            """
            SELECT * FROM template_subtasks
            WHERE template_task_id = ? ORDER BY position
            """,
            (task["id"],),
        ).fetchall()
        tasks.append(
            TemplateTaskDetail(
                **dict(task),
                subtasks=[TemplateSubtaskOut(**dict(row)) for row in subtasks],
            )
        )
    role_rows = db.execute(
        """
        SELECT r.id, r.name, r.category, r.is_required
        FROM template_roles tr JOIN roles r ON r.id = tr.role_id
        WHERE tr.event_template_id = ? ORDER BY r.category, r.name
        """,
        (template_id,),
    ).fetchall()
    basic = template_model(template)
    return TemplateDetail(
        **basic.model_dump(),
        tasks=tasks,
        roles=[
            TemplateRoleOut(
                id=row["id"],
                name=row["name"],
                category=row["category"],
                is_required=bool(row["is_required"]),
            )
            for row in role_rows
        ],
    )


@router.post("", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(payload: TemplateCreate, db: Connection) -> TemplateOut:
    row = db.execute(
        """
        INSERT INTO event_templates (name, description, beneficiary_id)
        VALUES (?, ?, ?) RETURNING *
        """,
        (payload.name, payload.description, payload.beneficiary_id),
    ).fetchone()
    db.commit()
    return template_model(row)


@router.patch("/{template_id}", response_model=TemplateOut)
def update_template(
    template_id: int, payload: TemplateUpdate, db: Connection
) -> TemplateOut:
    current = require_template(db, template_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return template_model(current)
    assignments = ", ".join(f"{field} = ?" for field in values)
    row = db.execute(
        f"UPDATE event_templates SET {assignments} WHERE id = ? RETURNING *",
        [*values.values(), template_id],
    ).fetchone()
    db.commit()
    return template_model(row)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Connection) -> Response:
    template = require_template(db, template_id)
    if template["is_built_in"]:
        raise HTTPException(409, "Built-in event templates cannot be deleted")
    try:
        db.execute("DELETE FROM event_templates WHERE id = ?", (template_id,))
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Event template is in use by an event") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{template_id}/clone",
    response_model=TemplateOut,
    status_code=status.HTTP_201_CREATED,
)
def clone_template(
    template_id: int, payload: TemplateClone, db: Connection
) -> TemplateOut:
    source = require_template(db, template_id)
    clone_name = payload.name or f"{source['name']} copy"
    with db:
        cloned = db.execute(
            """
            INSERT INTO event_templates (name, description, is_built_in, beneficiary_id)
            VALUES (?, ?, 0, ?) RETURNING *
            """,
            (clone_name, source["description"], source["beneficiary_id"]),
        ).fetchone()
        tasks = db.execute(
            "SELECT * FROM template_tasks WHERE event_template_id = ?",
            (template_id,),
        ).fetchall()
        for task in tasks:
            new_task = db.execute(
                """
                INSERT INTO template_tasks
                    (event_template_id, name, body, relative_due_days,
                     category, position)
                VALUES (?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (
                    cloned["id"],
                    task["name"],
                    task["body"],
                    task["relative_due_days"],
                    task["category"],
                    task["position"],
                ),
            ).fetchone()
            db.execute(
                """
                INSERT INTO template_subtasks (template_task_id, title, position)
                SELECT ?, title, position FROM template_subtasks
                WHERE template_task_id = ?
                """,
                (new_task["id"], task["id"]),
            )
        db.execute(
            """
            INSERT INTO template_roles (event_template_id, role_id)
            SELECT ?, role_id FROM template_roles WHERE event_template_id = ?
            """,
            (cloned["id"], template_id),
        )
    return template_model(cloned)


@router.post(
    "/{template_id}/tasks",
    response_model=TemplateTaskOut,
    status_code=status.HTTP_201_CREATED,
)
def create_template_task(
    template_id: int, payload: TemplateTaskCreate, db: Connection
) -> TemplateTaskOut:
    require_template(db, template_id)
    position = payload.position
    if position is None:
        position = db.execute(
            """
            SELECT COALESCE(MAX(position) + 1, 0)
            FROM template_tasks WHERE event_template_id = ?
            """,
            (template_id,),
        ).fetchone()[0]
    try:
        row = db.execute(
            """
            INSERT INTO template_tasks
                (event_template_id, name, body, relative_due_days, category, position)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *
            """,
            (
                template_id,
                payload.name,
                payload.body,
                payload.relative_due_days,
                payload.category,
                position,
            ),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Task position is already in use") from error
    return TemplateTaskOut(**dict(row))


@router.get("/{template_id}/tasks")
def list_template_tasks(
    template_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    category: Annotated[TaskCategory | None, Query()] = None,
) -> dict:
    require_template(db, template_id)
    where = ["event_template_id = ?"]
    params: list[object] = [template_id]
    if category is not None:
        where.append("category = ?")
        params.append(category)
    clause = " AND ".join(where)
    total = db.execute(
        f"SELECT COUNT(*) FROM template_tasks WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM template_tasks WHERE {clause}
        ORDER BY position LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope(
        [TemplateTaskOut(**dict(row)) for row in rows], total, pagination
    )


@router.get("/{template_id}/tasks/{task_id}", response_model=TemplateTaskOut)
def get_template_task(
    template_id: int, task_id: int, db: Connection
) -> TemplateTaskOut:
    return TemplateTaskOut(**dict(require_template_task(db, template_id, task_id)))


@router.patch("/{template_id}/tasks/{task_id}", response_model=TemplateTaskOut)
def update_template_task(
    template_id: int,
    task_id: int,
    payload: TemplateTaskUpdate,
    db: Connection,
) -> TemplateTaskOut:
    current = require_template_task(db, template_id, task_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return TemplateTaskOut(**dict(current))
    assignments = ", ".join(f"{field} = ?" for field in values)
    try:
        row = db.execute(
            f"UPDATE template_tasks SET {assignments} WHERE id = ? RETURNING *",
            [*values.values(), task_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Task position is already in use") from error
    return TemplateTaskOut(**dict(row))


@router.delete(
    "/{template_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_template_task(
    template_id: int, task_id: int, db: Connection
) -> Response:
    require_template_task(db, template_id, task_id)
    db.execute("DELETE FROM template_tasks WHERE id = ?", (task_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{template_id}/tasks/order", response_model=list[TemplateTaskOut]
)
def reorder_template_tasks(
    template_id: int, payload: TaskOrder, db: Connection
) -> list[TemplateTaskOut]:
    require_template(db, template_id)
    rows = db.execute(
        "SELECT id FROM template_tasks WHERE event_template_id = ?", (template_id,)
    ).fetchall()
    current_ids = [row["id"] for row in rows]
    if len(payload.task_ids) != len(set(payload.task_ids)) or set(
        payload.task_ids
    ) != set(current_ids):
        raise HTTPException(400, "task_ids must contain every template task exactly once")
    maximum = db.execute(
        """
        SELECT COALESCE(MAX(position), 0) FROM template_tasks
        WHERE event_template_id = ?
        """,
        (template_id,),
    ).fetchone()[0]
    with db:
        db.execute(
            """
            UPDATE template_tasks SET position = position + ?
            WHERE event_template_id = ?
            """,
            (maximum + len(current_ids), template_id),
        )
        for position, task_id in enumerate(payload.task_ids):
            db.execute(
                "UPDATE template_tasks SET position = ? WHERE id = ?",
                (position, task_id),
            )
    return [
        TemplateTaskOut(**dict(require_template_task(db, template_id, task_id)))
        for task_id in payload.task_ids
    ]


@router.post(
    "/{template_id}/tasks/{task_id}/subtasks",
    response_model=TemplateSubtaskOut,
    status_code=status.HTTP_201_CREATED,
)
def create_template_subtask(
    template_id: int,
    task_id: int,
    payload: TemplateSubtaskCreate,
    db: Connection,
) -> TemplateSubtaskOut:
    require_template_task(db, template_id, task_id)
    position = payload.position
    if position is None:
        position = db.execute(
            """
            SELECT COALESCE(MAX(position) + 1, 0)
            FROM template_subtasks WHERE template_task_id = ?
            """,
            (task_id,),
        ).fetchone()[0]
    try:
        row = db.execute(
            """
            INSERT INTO template_subtasks (template_task_id, title, position)
            VALUES (?, ?, ?) RETURNING *
            """,
            (task_id, payload.title, position),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Subtask position is already in use") from error
    return TemplateSubtaskOut(**dict(row))


def require_template_subtask(
    db: sqlite3.Connection, task_id: int, subtask_id: int
) -> sqlite3.Row:
    row = db.execute(
        """
        SELECT * FROM template_subtasks
        WHERE id = ? AND template_task_id = ?
        """,
        (subtask_id, task_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Template subtask {subtask_id} was not found")
    return row


@router.patch(
    "/{template_id}/tasks/{task_id}/subtasks/{subtask_id}",
    response_model=TemplateSubtaskOut,
)
def update_template_subtask(
    template_id: int,
    task_id: int,
    subtask_id: int,
    payload: TemplateSubtaskUpdate,
    db: Connection,
) -> TemplateSubtaskOut:
    require_template_task(db, template_id, task_id)
    current = require_template_subtask(db, task_id, subtask_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return TemplateSubtaskOut(**dict(current))
    assignments = ", ".join(f"{field} = ?" for field in values)
    try:
        row = db.execute(
            f"UPDATE template_subtasks SET {assignments} WHERE id = ? RETURNING *",
            [*values.values(), subtask_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Subtask position is already in use") from error
    return TemplateSubtaskOut(**dict(row))


@router.delete(
    "/{template_id}/tasks/{task_id}/subtasks/{subtask_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_template_subtask(
    template_id: int, task_id: int, subtask_id: int, db: Connection
) -> Response:
    require_template_task(db, template_id, task_id)
    require_template_subtask(db, task_id, subtask_id)
    db.execute("DELETE FROM template_subtasks WHERE id = ?", (subtask_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{template_id}/tasks/{task_id}/subtasks/order",
    response_model=list[TemplateSubtaskOut],
)
def reorder_template_subtasks(
    template_id: int,
    task_id: int,
    payload: SubtaskOrder,
    db: Connection,
) -> list[TemplateSubtaskOut]:
    require_template_task(db, template_id, task_id)
    rows = db.execute(
        "SELECT id FROM template_subtasks WHERE template_task_id = ?", (task_id,)
    ).fetchall()
    current_ids = [row["id"] for row in rows]
    if len(payload.subtask_ids) != len(set(payload.subtask_ids)) or set(
        payload.subtask_ids
    ) != set(current_ids):
        raise HTTPException(
            400, "subtask_ids must contain every template subtask exactly once"
        )
    maximum = db.execute(
        """
        SELECT COALESCE(MAX(position), 0) FROM template_subtasks
        WHERE template_task_id = ?
        """,
        (task_id,),
    ).fetchone()[0]
    with db:
        db.execute(
            """
            UPDATE template_subtasks SET position = position + ?
            WHERE template_task_id = ?
            """,
            (maximum + len(current_ids), task_id),
        )
        for position, subtask_id in enumerate(payload.subtask_ids):
            db.execute(
                "UPDATE template_subtasks SET position = ? WHERE id = ?",
                (position, subtask_id),
            )
    ordered = db.execute(
        """
        SELECT * FROM template_subtasks
        WHERE template_task_id = ? ORDER BY position
        """,
        (task_id,),
    ).fetchall()
    return [TemplateSubtaskOut(**dict(row)) for row in ordered]
