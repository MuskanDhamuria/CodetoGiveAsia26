"""Internal organizer directory and assigned work."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.schema.team_members import (
    TeamMemberCreate,
    TeamMemberOut,
    TeamMemberUpdate,
)


router = APIRouter(prefix="/team-members", tags=["team members"])


def member_model(row: sqlite3.Row) -> TeamMemberOut:
    return TeamMemberOut(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def require_member(db: sqlite3.Connection, member_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM team_members WHERE id = ?", (member_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Team member {member_id} was not found")
    return row


@router.get("")
def list_team_members(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    is_active: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    where = ["1 = 1"]
    params: list[object] = []
    if is_active is not None:
        where.append("is_active = ?")
        params.append(int(is_active))
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        where.append("(name LIKE ? OR email LIKE ?)")
        params.extend([term, term])
    clause = " AND ".join(where)
    total = db.execute(
        f"SELECT COUNT(*) FROM team_members WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM team_members WHERE {clause}
        ORDER BY is_active DESC, name LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope([member_model(row) for row in rows], total, pagination)


@router.post("", response_model=TeamMemberOut, status_code=status.HTTP_201_CREATED)
def create_team_member(payload: TeamMemberCreate, db: Connection) -> TeamMemberOut:
    try:
        row = db.execute(
            """
            INSERT INTO team_members (name, email, is_active)
            VALUES (?, ?, ?) RETURNING *
            """,
            (payload.name, payload.email, int(payload.is_active)),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "A team member with that email already exists") from error
    return member_model(row)


@router.get("/{member_id}", response_model=TeamMemberOut)
def get_team_member(member_id: int, db: Connection) -> TeamMemberOut:
    return member_model(require_member(db, member_id))


@router.patch("/{member_id}", response_model=TeamMemberOut)
def update_team_member(
    member_id: int, payload: TeamMemberUpdate, db: Connection
) -> TeamMemberOut:
    current = require_member(db, member_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return member_model(current)
    assignments = ", ".join(f"{field} = ?" for field in values)
    params = [int(value) if isinstance(value, bool) else value for value in values.values()]
    try:
        row = db.execute(
            f"UPDATE team_members SET {assignments} WHERE id = ? RETURNING *",
            [*params, member_id],
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "A team member with that email already exists") from error
    return member_model(row)


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team_member(member_id: int, db: Connection) -> Response:
    require_member(db, member_id)
    db.execute("DELETE FROM team_members WHERE id = ?", (member_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{member_id}/tasks")
def list_team_member_tasks(
    member_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    task_status: Annotated[str | None, Query(alias="status")] = None,
    event_id: Annotated[int | None, Query()] = None,
    due_before: Annotated[str | None, Query()] = None,
) -> dict:
    require_member(db, member_id)
    where = ["EXISTS (SELECT 1 FROM event_task_assignees eta WHERE eta.event_task_id = t.id AND eta.team_member_id = ?)"]
    params: list[object] = [member_id]
    if task_status is not None:
        where.append("t.status = ?")
        params.append(task_status)
    if event_id is not None:
        where.append("t.event_id = ?")
        params.append(event_id)
    if due_before is not None:
        where.append("t.due_at <= ?")
        params.append(due_before)
    clause = " AND ".join(where)
    total = db.execute(
        f"SELECT COUNT(*) FROM event_tasks t WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT t.id, t.event_id, e.name AS event_name, t.name, t.body,
               t.due_at, t.category, t.status, t.position
        FROM event_tasks t JOIN events e ON e.id = t.event_id
        WHERE {clause} ORDER BY t.due_at, t.position LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    return list_envelope([dict(row) for row in rows], total, pagination)
