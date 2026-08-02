"""Volunteer profiles and event volunteer-signup processing.

Implements the "Volunteers" and "Event volunteer signups" sections of
`backend/API_ENDPOINTS.md`. The domain model treats a Volunteer as approved for
an event and assigned a volunteer Role through `volunteer_signups`; volunteers
are not internal task assignees.
"""

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
from backend.phone import InvalidPhoneNumberError, normalize_phone_number
from backend.schema.volunteers import (
    EventRoleCreate,
    PublicSignupInput,
    PublicSignupResult,
    RoleInterestOut,
    RoleOut,
    SignupApprove,
    SignupOut,
    SignupUpdate,
    SkillOut,
    VolunteerCounts,
    VolunteerDetail,
    VolunteerEventHistory,
    VolunteerListItem,
)

router = APIRouter(tags=["volunteers"])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def require_volunteer(db: sqlite3.Connection, volunteer_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT id, name, contact_number, email, signup_status FROM volunteers WHERE id = ?",
        (volunteer_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Volunteer {volunteer_id} was not found")
    return row


def require_event(db: sqlite3.Connection, event_id: int) -> None:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} was not found")


def signup_row(db: sqlite3.Connection, event_id: int, signup_id: int) -> sqlite3.Row:
    row = db.execute(
        """
        SELECT vs.id, vs.event_id, vs.volunteer_id, v.name AS volunteer_name,
               vs.status, vs.assigned_role_id, r.name AS assigned_role_name,
               vs.is_leader, vs.attendance
        FROM volunteer_signups vs
        JOIN volunteers v ON v.id = vs.volunteer_id
        LEFT JOIN roles r ON r.id = vs.assigned_role_id
        WHERE vs.id = ? AND vs.event_id = ?
        """,
        (signup_id, event_id),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Volunteer signup {signup_id} was not found for event {event_id}",
        )
    return row


def signup_to_model(db: sqlite3.Connection, row: sqlite3.Row) -> SignupOut:
    preferred_roles = db.execute(
        """
        SELECT r.name
        FROM volunteer_signup_role_preferences preference
        JOIN roles r ON r.id = preference.role_id
        WHERE preference.signup_id = ?
        ORDER BY COALESCE(preference.priority, 2147483647), r.name
        """,
        (row["id"],),
    ).fetchall()
    return SignupOut(
        id=row["id"],
        event_id=row["event_id"],
        volunteer_id=row["volunteer_id"],
        volunteer_name=row["volunteer_name"],
        status=row["status"],
        assigned_role_id=row["assigned_role_id"],
        assigned_role_name=row["assigned_role_name"],
        preferred_role_names=[role["name"] for role in preferred_roles],
        is_leader=bool(row["is_leader"]),
        attendance=as_bool(row["attendance"]),
    )


# --------------------------------------------------------------------------- #
# Volunteer profiles
# --------------------------------------------------------------------------- #
@router.get("/volunteers", summary="Search and filter volunteer profiles")
def list_volunteers(
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    signup_status: Annotated[str | None, Query()] = None,
    skill_id: Annotated[int | None, Query()] = None,
    role_id: Annotated[int | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    where = ["1 = 1"]
    params: list[object] = []
    if signup_status is not None:
        where.append("v.signup_status = ?")
        params.append(signup_status)
    if skill_id is not None:
        where.append("EXISTS (SELECT 1 FROM volunteer_skills vsk WHERE vsk.volunteer_id = v.id AND vsk.skill_id = ?)")
        params.append(skill_id)
    if role_id is not None:
        where.append("EXISTS (SELECT 1 FROM volunteer_interests vi WHERE vi.volunteer_id = v.id AND vi.role_id = ?)")
        params.append(role_id)
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        where.append("(v.name LIKE ? OR v.email LIKE ? OR v.contact_number LIKE ?)")
        params.extend([term, term, term])
    clause = " AND ".join(where)

    total = db.execute(
        f"SELECT COUNT(*) FROM volunteers v WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT v.id, v.name, v.contact_number, v.email, v.signup_status,
            (SELECT COUNT(*) FROM volunteer_signups vs WHERE vs.volunteer_id = v.id)
                AS events_signed_up,
            (SELECT COUNT(*) FROM volunteer_signups vs
                WHERE vs.volunteer_id = v.id AND vs.status = 'approved')
                AS events_approved,
            (SELECT COUNT(*) FROM volunteer_signups vs
                WHERE vs.volunteer_id = v.id AND vs.attendance = 1)
                AS events_attended
        FROM volunteers v WHERE {clause}
        ORDER BY v.name
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    skills_by_volunteer: dict[int, list[str]] = {}
    for row in db.execute(
        """
        SELECT vsk.volunteer_id, s.name FROM volunteer_skills vsk
        JOIN skills s ON s.id = vsk.skill_id
        ORDER BY s.name
        """
    ).fetchall():
        skills_by_volunteer.setdefault(row["volunteer_id"], []).append(row["name"])
    items = [
        VolunteerListItem(
            id=row["id"],
            name=row["name"],
            contact_number=row["contact_number"],
            email=row["email"],
            signup_status=row["signup_status"],
            skills=skills_by_volunteer.get(row["id"], []),
            counts=VolunteerCounts(
                events_signed_up=row["events_signed_up"],
                events_approved=row["events_approved"],
                events_attended=row["events_attended"],
            ),
        )
        for row in rows
    ]
    return list_envelope(items, total, pagination)


@router.get(
    "/volunteers/{volunteer_id}",
    response_model=VolunteerDetail,
    summary="Get volunteer profile, skills, interests, and summary counts",
)
def get_volunteer(volunteer_id: int, db: Connection) -> VolunteerDetail:
    volunteer = require_volunteer(db, volunteer_id)
    skills = [
        SkillOut(id=row["id"], name=row["name"])
        for row in db.execute(
            """
            SELECT s.id, s.name FROM volunteer_skills vsk
            JOIN skills s ON s.id = vsk.skill_id
            WHERE vsk.volunteer_id = ? ORDER BY s.name
            """,
            (volunteer_id,),
        ).fetchall()
    ]
    interests = [
        RoleInterestOut(role_id=row["id"], name=row["name"], is_lead=bool(row["is_lead"]))
        for row in db.execute(
            """
            SELECT r.id, r.name, vi.is_lead FROM volunteer_interests vi
            JOIN roles r ON r.id = vi.role_id
            WHERE vi.volunteer_id = ? ORDER BY r.name
            """,
            (volunteer_id,),
        ).fetchall()
    ]
    counts_row = db.execute(
        """
        SELECT
            COUNT(*) AS events_signed_up,
            COALESCE(SUM(status = 'approved'), 0) AS events_approved,
            COALESCE(SUM(attendance = 1), 0) AS events_attended
        FROM volunteer_signups WHERE volunteer_id = ?
        """,
        (volunteer_id,),
    ).fetchone()
    return VolunteerDetail(
        **dict(volunteer),
        skills=skills,
        interests=interests,
        counts=VolunteerCounts(
            events_signed_up=counts_row["events_signed_up"],
            events_approved=counts_row["events_approved"],
            events_attended=counts_row["events_attended"],
        ),
    )


@router.delete(
    "/volunteers/{volunteer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently remove a volunteer and their related records",
)
def delete_volunteer(volunteer_id: int, db: Connection) -> Response:
    require_volunteer(db, volunteer_id)
    db.execute("DELETE FROM volunteers WHERE id = ?", (volunteer_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/volunteers/{volunteer_id}/events",
    summary="Get a volunteer's signup, role, and attendance history",
)
def get_volunteer_events(
    volunteer_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    status: Annotated[str | None, Query()] = None,
    attendance: Annotated[bool | None, Query()] = None,
) -> dict:
    require_volunteer(db, volunteer_id)
    where = ["vs.volunteer_id = ?"]
    params: list[object] = [volunteer_id]
    if status is not None:
        where.append("vs.status = ?")
        params.append(status)
    if attendance is not None:
        where.append("vs.attendance = ?")
        params.append(1 if attendance else 0)
    clause = " AND ".join(where)

    total = db.execute(
        f"SELECT COUNT(*) FROM volunteer_signups vs WHERE {clause}", params
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT vs.id AS signup_id, e.id AS event_id, e.name AS event_name,
               e.event_date, vs.status, vs.assigned_role_id,
               r.name AS assigned_role_name, vs.is_leader, vs.attendance
        FROM volunteer_signups vs
        JOIN events e ON e.id = vs.event_id
        LEFT JOIN roles r ON r.id = vs.assigned_role_id
        WHERE {clause}
        ORDER BY e.event_date DESC
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [
        VolunteerEventHistory(
            signup_id=row["signup_id"],
            event_id=row["event_id"],
            event_name=row["event_name"],
            event_date=row["event_date"],
            status=row["status"],
            assigned_role_id=row["assigned_role_id"],
            assigned_role_name=row["assigned_role_name"],
            preferred_role_names=[
                preference["name"]
                for preference in db.execute(
                    """
                    SELECT roles.name
                    FROM volunteer_signup_role_preferences AS preferences
                    JOIN roles ON roles.id = preferences.role_id
                    WHERE preferences.signup_id = ?
                    ORDER BY COALESCE(preferences.priority, 2147483647), roles.name
                    """,
                    (row["signup_id"],),
                ).fetchall()
            ],
            is_leader=bool(row["is_leader"]),
            attendance=as_bool(row["attendance"]),
        )
        for row in rows
    ]
    return list_envelope(items, total, pagination)


# --------------------------------------------------------------------------- #
# Event volunteer signups
# --------------------------------------------------------------------------- #
@router.get(
    "/events/{event_id}/roles",
    response_model=list[RoleOut],
    summary="List the volunteer roles available for an event",
)
def list_event_roles(event_id: int, db: Connection) -> list[RoleOut]:
    require_event(db, event_id)
    rows = db.execute(
        """
        SELECT r.id, r.name, r.category, r.is_required
        FROM event_roles er
        JOIN roles r ON r.id = er.role_id
        WHERE er.event_id = ?
        ORDER BY r.name
        """,
        (event_id,),
    ).fetchall()
    return [
        RoleOut(
            id=row["id"],
            name=row["name"],
            category=row["category"],
            is_required=bool(row["is_required"]),
        )
        for row in rows
    ]


@router.post(
    "/events/{event_id}/roles",
    response_model=RoleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a volunteer role to one event",
)
def create_event_role(
    event_id: int, payload: EventRoleCreate, db: Connection
) -> RoleOut:
    require_event(db, event_id)
    role_name = payload.name.strip()
    if not role_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Role name cannot be blank",
        )
    with db:
        db.execute(
            """
            INSERT OR IGNORE INTO roles (name, category, is_required)
            VALUES (?, 'volunteer', 0)
            """,
            (role_name,),
        )
        role = db.execute(
            """
            SELECT id, name, category, is_required FROM roles
            WHERE name = ? COLLATE NOCASE AND category = 'volunteer'
            """,
            (role_name,),
        ).fetchone()
        exists = db.execute(
            "SELECT 1 FROM event_roles WHERE event_id = ? AND role_id = ?",
            (event_id, role["id"]),
        ).fetchone()
        if exists is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{role['name']} is already available for this event",
            )
        db.execute(
            "INSERT INTO event_roles (event_id, role_id) VALUES (?, ?)",
            (event_id, role["id"]),
        )
    return RoleOut(
        id=role["id"],
        name=role["name"],
        category=role["category"],
        is_required=bool(role["is_required"]),
    )


@router.delete(
    "/events/{event_id}/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a volunteer role from one event",
)
def delete_event_role(
    event_id: int, role_id: int, db: Connection
) -> Response:
    require_event(db, event_id)
    role = db.execute(
        """
        SELECT r.name FROM event_roles er
        JOIN roles r ON r.id = er.role_id
        WHERE er.event_id = ? AND er.role_id = ?
        """,
        (event_id, role_id),
    ).fetchone()
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Role {role_id} is not available for event {event_id}",
        )
    assigned_count = db.execute(
        """
        SELECT COUNT(*) FROM volunteer_signups
        WHERE event_id = ? AND assigned_role_id = ? AND status != 'rejected'
        """,
        (event_id, role_id),
    ).fetchone()[0]
    if assigned_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Reassign {assigned_count} volunteer"
                f"{'s' if assigned_count != 1 else ''} before removing {role['name']}"
            ),
        )
    with db:
        db.execute(
            "DELETE FROM event_roles WHERE event_id = ? AND role_id = ?",
            (event_id, role_id),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/events/{event_id}/volunteer-signups",
    summary="List volunteer requests and assignments for an event",
)
def list_event_signups(
    event_id: int,
    db: Connection,
    pagination: Annotated[Pagination, Depends()],
    status: Annotated[str | None, Query()] = None,
    role_id: Annotated[int | None, Query()] = None,
    attendance: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    require_event(db, event_id)
    where = ["vs.event_id = ?"]
    params: list[object] = [event_id]
    if status is not None:
        where.append("vs.status = ?")
        params.append(status)
    if role_id is not None:
        where.append("vs.assigned_role_id = ?")
        params.append(role_id)
    if attendance is not None:
        where.append("vs.attendance = ?")
        params.append(1 if attendance else 0)
    if q is not None and q.strip():
        where.append("v.name LIKE ?")
        params.append(f"%{q.strip()}%")
    clause = " AND ".join(where)

    total = db.execute(
        f"""
        SELECT COUNT(*) FROM volunteer_signups vs
        JOIN volunteers v ON v.id = vs.volunteer_id
        WHERE {clause}
        """,
        params,
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT vs.id, vs.event_id, vs.volunteer_id, v.name AS volunteer_name,
               vs.status, vs.assigned_role_id, r.name AS assigned_role_name,
               vs.is_leader, vs.attendance
        FROM volunteer_signups vs
        JOIN volunteers v ON v.id = vs.volunteer_id
        LEFT JOIN roles r ON r.id = vs.assigned_role_id
        WHERE {clause}
        ORDER BY v.name
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [signup_to_model(db, row) for row in rows]
    return list_envelope(items, total, pagination)


def list_signups_across_events(
    db: sqlite3.Connection,
    pagination: Pagination,
    status: str | None = None,
    role_id: int | None = None,
    attendance: bool | None = None,
    q: str | None = None,
) -> dict:
    """TICKET-37: same filters as list_event_signups, minus the event_id

    requirement, so the AI can answer "which volunteers haven't been
    approved?" without an organizer having to name an event first. Rows
    carry event_id/event_name/event_date so a follow-up action can target
    a specific one.
    """
    where = ["1 = 1"]
    params: list[object] = []
    if status is not None:
        where.append("vs.status = ?")
        params.append(status)
    if role_id is not None:
        where.append("vs.assigned_role_id = ?")
        params.append(role_id)
    if attendance is not None:
        where.append("vs.attendance = ?")
        params.append(1 if attendance else 0)
    if q is not None and q.strip():
        where.append("v.name LIKE ?")
        params.append(f"%{q.strip()}%")
    clause = " AND ".join(where)

    total = db.execute(
        f"""
        SELECT COUNT(*) FROM volunteer_signups vs
        JOIN volunteers v ON v.id = vs.volunteer_id
        WHERE {clause}
        """,
        params,
    ).fetchone()[0]
    rows = db.execute(
        f"""
        SELECT vs.id, vs.event_id, e.name AS event_name, e.event_date,
               vs.volunteer_id, v.name AS volunteer_name,
               vs.status, vs.assigned_role_id, r.name AS assigned_role_name,
               vs.is_leader, vs.attendance
        FROM volunteer_signups vs
        JOIN volunteers v ON v.id = vs.volunteer_id
        JOIN events e ON e.id = vs.event_id
        LEFT JOIN roles r ON r.id = vs.assigned_role_id
        WHERE {clause}
        ORDER BY e.event_date, v.name
        LIMIT ? OFFSET ?
        """,
        [*params, pagination.limit, pagination.offset],
    ).fetchall()
    items = [
        {
            "id": row["id"],
            "event_id": row["event_id"],
            "event_name": row["event_name"],
            "event_date": row["event_date"],
            "volunteer_id": row["volunteer_id"],
            "volunteer_name": row["volunteer_name"],
            "status": row["status"],
            "assigned_role_id": row["assigned_role_id"],
            "assigned_role_name": row["assigned_role_name"],
            "is_leader": bool(row["is_leader"]),
            "attendance": as_bool(row["attendance"]),
        }
        for row in rows
    ]
    return list_envelope(items, total, pagination)


@router.get(
    "/events/{event_id}/volunteer-signups/{signup_id}",
    response_model=SignupOut,
    summary="Get one volunteer signup",
)
def get_event_signup(event_id: int, signup_id: int, db: Connection) -> SignupOut:
    return signup_to_model(db, signup_row(db, event_id, signup_id))


@router.patch(
    "/events/{event_id}/volunteer-signups/{signup_id}",
    response_model=SignupOut,
    summary="Process a request, assign a role, set leader, or record attendance",
)
def update_event_signup(
    event_id: int, signup_id: int, payload: SignupUpdate, db: Connection
) -> SignupOut:
    signup_row(db, event_id, signup_id)
    updates: list[str] = []
    params: list[object] = []
    if payload.status is not None:
        updates.append("status = ?")
        params.append(payload.status)
    if "assigned_role_id" in payload.model_fields_set:
        if payload.assigned_role_id is not None:
            _require_role_for_event(db, event_id, payload.assigned_role_id)
        updates.append("assigned_role_id = ?")
        params.append(payload.assigned_role_id)
    if payload.is_leader is not None:
        updates.append("is_leader = ?")
        params.append(1 if payload.is_leader else 0)
    if "attendance" in payload.model_fields_set:
        updates.append("attendance = ?")
        params.append(None if payload.attendance is None else (1 if payload.attendance else 0))
    if updates:
        params.append(signup_id)
        db.execute(
            f"UPDATE volunteer_signups SET {', '.join(updates)} WHERE id = ?", params
        )
        db.commit()
    return signup_to_model(db, signup_row(db, event_id, signup_id))


@router.post(
    "/events/{event_id}/volunteer-signups/{signup_id}/approve",
    response_model=SignupOut,
    summary="Approve and assign a volunteer in one action",
)
def approve_event_signup(
    event_id: int, signup_id: int, payload: SignupApprove, db: Connection
) -> SignupOut:
    signup_row(db, event_id, signup_id)
    _require_role_for_event(db, event_id, payload.assigned_role_id)
    db.execute(
        """
        UPDATE volunteer_signups
        SET status = 'approved', assigned_role_id = ?, is_leader = ?
        WHERE id = ?
        """,
        (payload.assigned_role_id, 1 if payload.is_leader else 0, signup_id),
    )
    db.commit()
    return signup_to_model(db, signup_row(db, event_id, signup_id))


@router.post(
    "/events/{event_id}/volunteer-signups/{signup_id}/reject",
    response_model=SignupOut,
    summary="Reject a request and clear any assignment",
)
def reject_event_signup(event_id: int, signup_id: int, db: Connection) -> SignupOut:
    signup_row(db, event_id, signup_id)
    db.execute(
        """
        UPDATE volunteer_signups
        SET status = 'rejected', assigned_role_id = NULL, is_leader = 0
        WHERE id = ?
        """,
        (signup_id,),
    )
    db.commit()
    return signup_to_model(db, signup_row(db, event_id, signup_id))


def _require_role_for_event(
    db: sqlite3.Connection, event_id: int, role_id: int
) -> None:
    row = db.execute(
        """
        SELECT 1 FROM event_roles
        WHERE event_id = ? AND role_id = ?
        """,
        (event_id, role_id),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Role {role_id} is not available for event {event_id}",
        )


# --------------------------------------------------------------------------- #
# Public self-service signup
# --------------------------------------------------------------------------- #
@router.post(
    "/public/events/{event_id}/volunteer-signups",
    response_model=PublicSignupResult,
    summary="Public volunteer signup — find or create by phone, then request the event",
)
def public_signup(
    event_id: int, payload: PublicSignupInput, db: Connection
) -> PublicSignupResult:
    require_event(db, event_id)

    name = payload.name.strip()
    try:
        phone = normalize_phone_number(payload.contact_number)
    except InvalidPhoneNumberError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Enter a valid phone number.",
        ) from error
    email = payload.email.strip() if payload.email else None
    if not name:
        raise HTTPException(status_code=400, detail="Enter your name.")

    # Validate chosen roles belong to the event before mutating anything.
    for role_id in payload.role_ids:
        _require_role_for_event(db, event_id, role_id)

    # Find-or-create the volunteer by phone number.
    existing = db.execute(
        "SELECT id FROM volunteers WHERE contact_number = ?", (phone,)
    ).fetchone()
    if existing is not None:
        volunteer_id = existing["id"]
        volunteer_created = False
    else:
        try:
            volunteer_id = db.execute(
                """
                INSERT INTO volunteers (name, contact_number, email)
                VALUES (?, ?, ?) RETURNING id
                """,
                (name, phone, email),
            ).fetchone()["id"]
        except sqlite3.IntegrityError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That email is already registered to a different phone number.",
            ) from error
        volunteer_created = True

    # One signup per volunteer per event.
    if db.execute(
        "SELECT 1 FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
        (event_id, volunteer_id),
    ).fetchone() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already signed up for this event.",
        )

    signup_id = db.execute(
        """
        INSERT INTO volunteer_signups (event_id, volunteer_id, status)
        VALUES (?, ?, 'requested') RETURNING id
        """,
        (event_id, volunteer_id),
    ).fetchone()["id"]

    # Unranked preferences: store each chosen role with a null priority.
    for role_id in payload.role_ids:
        db.execute(
            """
            INSERT INTO volunteer_signup_role_preferences (signup_id, role_id, priority)
            VALUES (?, ?, NULL)
            """,
            (signup_id, role_id),
        )
    db.commit()

    return PublicSignupResult(
        signup=signup_to_model(db, signup_row(db, event_id, signup_id)),
        volunteer_created=volunteer_created,
    )
