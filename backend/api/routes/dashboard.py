"""Organizer dashboard, calendar, and event progress read models."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from backend.api.routes._common import Connection


router = APIRouter(tags=["dashboard"])


@router.get("/events/{event_id}/summary")
def event_summary(event_id: int, db: Connection) -> dict:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(404, f"Event {event_id} was not found")

    task_rows = db.execute(
        """
        SELECT category, COUNT(*) AS total,
               SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
               SUM(CASE WHEN status != 'done' AND date(due_at) < date('now')
                        THEN 1 ELSE 0 END) AS overdue
        FROM event_tasks WHERE event_id = ? GROUP BY category
        """,
        (event_id,),
    ).fetchall()
    by_category = {
        category: {"total": 0, "done": 0}
        for category in ("planning", "execution", "post_execution")
    }
    for row in task_rows:
        by_category[row["category"]] = {
            "total": row["total"],
            "done": row["done"],
        }
    participant = db.execute(
        """
        SELECT SUM(CASE WHEN rsvp_status = 1 THEN 1 ELSE 0 END) AS rsvp_yes,
               SUM(CASE WHEN attendance = 1 THEN 1 ELSE 0 END) AS attended
        FROM participations WHERE event_id = ?
        """,
        (event_id,),
    ).fetchone()
    signup_rows = db.execute(
        """
        SELECT status, COUNT(*) AS count FROM volunteer_signups
        WHERE event_id = ? GROUP BY status
        """,
        (event_id,),
    ).fetchall()
    volunteer_counts = {"requested": 0, "approved": 0, "rejected": 0}
    volunteer_counts.update({row["status"]: row["count"] for row in signup_rows})
    total_tasks = sum(row["total"] for row in task_rows)
    done_tasks = sum(row["done"] for row in task_rows)
    overdue_tasks = sum(row["overdue"] for row in task_rows)
    return {
        "event_id": event_id,
        "tasks": {
            "total": total_tasks,
            "done": done_tasks,
            "overdue": overdue_tasks,
            "by_category": by_category,
        },
        "participants": {
            "rsvp_yes": participant["rsvp_yes"] or 0,
            "attended": participant["attended"] or 0,
        },
        "volunteers": volunteer_counts,
    }


@router.get("/calendar/events")
def calendar_events(
    month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")],
    db: Connection,
    event_status: Annotated[str | None, Query(alias="status")] = None,
) -> dict:
    where = ["substr(event_date, 1, 7) = ?"]
    params: list[object] = [month]
    if event_status is not None:
        where.append("status = ?")
        params.append(event_status)
    where.append("cancelled_at IS NULL")
    rows = db.execute(
        f"""
        SELECT id, name, venue, event_date, status FROM events
        WHERE {' AND '.join(where)} ORDER BY event_date, name
        """,
        params,
    ).fetchall()
    return {"items": [dict(row) for row in rows], "total": len(rows)}


@router.get("/dashboard/summary")
def dashboard_summary(
    db: Connection,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
) -> dict:
    start = (date_from or date.today()).isoformat()
    end = date_to.isoformat() if date_to else None
    where = ["status = 'open'", "cancelled_at IS NULL", "event_date >= ?"]
    params: list[object] = [start]
    if end is not None:
        where.append("event_date <= ?")
        params.append(end)
    upcoming_events = db.execute(
        f"SELECT COUNT(*) FROM events WHERE {' AND '.join(where)}", params
    ).fetchone()[0]
    total_volunteers = db.execute("SELECT COUNT(*) FROM volunteers").fetchone()[0]
    pending_confirmations = db.execute(
        "SELECT COUNT(*) FROM volunteer_signups WHERE status = 'requested'"
    ).fetchone()[0]
    overdue_tasks = db.execute(
        """
        SELECT COUNT(*) FROM event_tasks
        WHERE status != 'done' AND date(due_at) < date('now')
        """
    ).fetchone()[0]
    due_soon = db.execute(
        """
        SELECT COUNT(*) FROM event_tasks
        WHERE status != 'done'
          AND date(due_at) BETWEEN date('now') AND date('now', '+14 days')
        """
    ).fetchone()[0]
    return {
        "upcoming_events": upcoming_events,
        "total_volunteers": total_volunteers,
        "pending_volunteer_confirmations": pending_confirmations,
        "overdue_tasks": overdue_tasks,
        "tasks_due_soon": due_soon,
    }


@router.get("/dashboard/brief")
def dashboard_brief(db: Connection) -> dict:
    """Ranked, actionable items for the AI panel's suggested-actions surface
    (TICKET-67). Reshapes dashboard_summary's own counts rather than
    duplicating its SQL — this endpoint adds no new queries.
    """
    summary = dashboard_summary(db)

    items: list[dict] = []
    pending = summary["pending_volunteer_confirmations"]
    if pending > 0:
        items.append(
            {
                "id": "pending_volunteer_confirmations",
                "label": f"{pending} volunteer signup{'s' if pending != 1 else ''} need review",
                "count": pending,
                "prompt": "Which volunteer signups need approval?",
            }
        )
    overdue = summary["overdue_tasks"]
    if overdue > 0:
        items.append(
            {
                "id": "overdue_tasks",
                "label": f"{overdue} task{'s are' if overdue != 1 else ' is'} overdue",
                "count": overdue,
                "prompt": "Which tasks are overdue?",
            }
        )
    due_soon = summary["tasks_due_soon"]
    if due_soon > 0:
        items.append(
            {
                "id": "tasks_due_soon",
                "label": f"{due_soon} task{'s' if due_soon != 1 else ''} due in the next 14 days",
                "count": due_soon,
                "prompt": "List upcoming tasks across all events",
            }
        )
    return {"items": items}


@router.get("/dashboard/upcoming-deadlines")
def upcoming_deadlines(
    db: Connection,
    days: Annotated[int, Query(ge=1, le=365)] = 14,
    team_member_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    end = (date.today() + timedelta(days=days)).isoformat()
    where = ["t.status != 'done'", "date(t.due_at) BETWEEN date('now') AND ?"]
    params: list[object] = [end]
    if team_member_id is not None:
        # Keep legacy task rows visible while databases transition to the
        # many-to-many assignee table.
        where.append("(t.team_member_id = ? OR EXISTS (SELECT 1 FROM event_task_assignees eta WHERE eta.event_task_id = t.id AND eta.team_member_id = ?))")
        params.extend([team_member_id, team_member_id])
    rows = db.execute(
        f"""
        SELECT t.id, t.event_id, e.name AS event_name, t.name, t.due_at,
               t.category, t.status, t.team_member_id
        FROM event_tasks t JOIN events e ON e.id = t.event_id
        WHERE {' AND '.join(where)} ORDER BY t.due_at LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    return {"items": [dict(row) for row in rows], "total": len(rows)}
