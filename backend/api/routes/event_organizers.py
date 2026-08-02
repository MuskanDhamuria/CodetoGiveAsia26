"""Event-specific organizers and grouped task-assignee options."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, Response, status

from backend.api.routes._common import Connection
from backend.schema.event_organizers import (
    EventOrganizerCreate,
    EventOrganizerOut,
    EventPersonOption,
    OrganizerCandidates,
    TaskAssigneeGroups,
)


router = APIRouter(prefix="/events/{event_id}", tags=["event organizers"])


def require_event(db: sqlite3.Connection, event_id: int) -> None:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(404, f"Event {event_id} was not found")


def require_approved_event_volunteer(
    db: sqlite3.Connection, event_id: int, volunteer_id: int
) -> sqlite3.Row:
    row = db.execute(
        """
        SELECT volunteers.id, volunteers.name, volunteers.email
        FROM volunteers
        JOIN volunteer_signups
          ON volunteer_signups.volunteer_id = volunteers.id
         AND volunteer_signups.event_id = ?
         AND volunteer_signups.status = 'approved'
        WHERE volunteers.id = ?
        """,
        (event_id, volunteer_id),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only approved volunteers for this event can receive tasks or become organisers",
        )
    return row


def _organizer_row(
    db: sqlite3.Connection, event_id: int, organizer_id: int
) -> sqlite3.Row:
    row = db.execute(
        """
        SELECT organizers.id, organizers.event_id,
               organizers.team_member_id, organizers.volunteer_id,
               COALESCE(team_members.name, volunteers.name) AS name,
               COALESCE(team_members.email, volunteers.email) AS email
        FROM event_organizers AS organizers
        LEFT JOIN team_members ON team_members.id = organizers.team_member_id
        LEFT JOIN volunteers ON volunteers.id = organizers.volunteer_id
        WHERE organizers.event_id = ? AND organizers.id = ?
        """,
        (event_id, organizer_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Event organiser {organizer_id} was not found")
    return row


def _organizer_model(row: sqlite3.Row) -> EventOrganizerOut:
    is_staff = row["team_member_id"] is not None
    return EventOrganizerOut(
        id=row["id"],
        event_id=row["event_id"],
        team_member_id=row["team_member_id"],
        volunteer_id=row["volunteer_id"],
        person_type="team_member" if is_staff else "volunteer",
        person_id=row["team_member_id"] if is_staff else row["volunteer_id"],
        name=row["name"],
        email=row["email"],
        identity_label="PTS staff" if is_staff else "Volunteer organiser",
    )


def _paired_identities(
    db: sqlite3.Connection,
    event_id: int,
    payload: EventOrganizerCreate,
) -> tuple[int | None, int | None]:
    if payload.person_type == "team_member":
        member = db.execute(
            "SELECT id, email, is_active FROM team_members WHERE id = ?",
            (payload.person_id,),
        ).fetchone()
        if member is None:
            raise HTTPException(404, f"Team member {payload.person_id} was not found")
        if not member["is_active"]:
            raise HTTPException(409, "Inactive PTS staff cannot be added as organisers")
        volunteer = db.execute(
            """
            SELECT volunteers.id
            FROM volunteers
            JOIN volunteer_signups
              ON volunteer_signups.volunteer_id = volunteers.id
             AND volunteer_signups.event_id = ?
             AND volunteer_signups.status = 'approved'
            WHERE volunteers.email IS NOT NULL
              AND lower(trim(volunteers.email)) = lower(trim(?))
            LIMIT 1
            """,
            (event_id, member["email"]),
        ).fetchone()
        return member["id"], volunteer["id"] if volunteer else None

    volunteer = require_approved_event_volunteer(db, event_id, payload.person_id)
    member = None
    if volunteer["email"]:
        member = db.execute(
            """
            SELECT id FROM team_members
            WHERE is_active = 1 AND lower(trim(email)) = lower(trim(?))
            LIMIT 1
            """,
            (volunteer["email"],),
        ).fetchone()
    return member["id"] if member else None, volunteer["id"]


def ensure_team_member_event_organizer(
    db: sqlite3.Connection, event_id: int, team_member_id: int
) -> None:
    payload = EventOrganizerCreate(person_type="team_member", person_id=team_member_id)
    team_id, volunteer_id = _paired_identities(db, event_id, payload)
    existing = db.execute(
        "SELECT id FROM event_organizers WHERE event_id = ? AND team_member_id = ?",
        (event_id, team_id),
    ).fetchone()
    if existing is None:
        db.execute(
            """
            INSERT INTO event_organizers (event_id, team_member_id, volunteer_id)
            VALUES (?, ?, ?)
            """,
            (event_id, team_id, volunteer_id),
        )


@router.get("/organizers", response_model=list[EventOrganizerOut])
def list_event_organizers(event_id: int, db: Connection) -> list[EventOrganizerOut]:
    require_event(db, event_id)
    rows = db.execute(
        """
        SELECT organizers.id, organizers.event_id,
               organizers.team_member_id, organizers.volunteer_id,
               COALESCE(team_members.name, volunteers.name) AS name,
               COALESCE(team_members.email, volunteers.email) AS email
        FROM event_organizers AS organizers
        LEFT JOIN team_members ON team_members.id = organizers.team_member_id
        LEFT JOIN volunteers ON volunteers.id = organizers.volunteer_id
        WHERE organizers.event_id = ?
        ORDER BY team_members.id IS NULL, name
        """,
        (event_id,),
    ).fetchall()
    return [_organizer_model(row) for row in rows]


@router.get("/organizer-candidates", response_model=OrganizerCandidates)
def list_organizer_candidates(event_id: int, db: Connection) -> OrganizerCandidates:
    require_event(db, event_id)
    staff = db.execute(
        """
        SELECT id, name, email FROM team_members
        WHERE is_active = 1
          AND NOT EXISTS (
              SELECT 1 FROM event_organizers
              WHERE event_id = ? AND team_member_id = team_members.id
          )
        ORDER BY name
        """,
        (event_id,),
    ).fetchall()
    volunteers = db.execute(
        """
        SELECT volunteers.id, volunteers.name, volunteers.email
        FROM volunteers
        JOIN volunteer_signups
          ON volunteer_signups.volunteer_id = volunteers.id
         AND volunteer_signups.event_id = ?
         AND volunteer_signups.status = 'approved'
        WHERE NOT EXISTS (
            SELECT 1 FROM event_organizers
            WHERE event_id = ? AND volunteer_id = volunteers.id
        )
        ORDER BY volunteers.name
        """,
        (event_id, event_id),
    ).fetchall()
    return OrganizerCandidates(
        pts_staff=[
            EventPersonOption(
                person_type="team_member", person_id=row["id"],
                name=row["name"], email=row["email"],
            )
            for row in staff
        ],
        volunteers=[
            EventPersonOption(
                person_type="volunteer", person_id=row["id"],
                name=row["name"], email=row["email"],
            )
            for row in volunteers
        ],
    )


@router.post(
    "/organizers",
    response_model=EventOrganizerOut,
    status_code=status.HTTP_201_CREATED,
)
def add_event_organizer(
    event_id: int, payload: EventOrganizerCreate, db: Connection
) -> EventOrganizerOut:
    require_event(db, event_id)
    team_member_id, volunteer_id = _paired_identities(db, event_id, payload)
    matches = db.execute(
        """
        SELECT id FROM event_organizers
        WHERE event_id = ?
          AND ((? IS NOT NULL AND team_member_id = ?)
            OR (? IS NOT NULL AND volunteer_id = ?))
        ORDER BY id
        """,
        (event_id, team_member_id, team_member_id, volunteer_id, volunteer_id),
    ).fetchall()
    if matches:
        organizer_id = matches[0]["id"]
        for duplicate in matches[1:]:
            db.execute("DELETE FROM event_organizers WHERE id = ?", (duplicate["id"],))
        db.execute(
            """
            UPDATE event_organizers
            SET team_member_id = ?, volunteer_id = ?
            WHERE id = ?
            """,
            (team_member_id, volunteer_id, organizer_id),
        )
    else:
        organizer_id = db.execute(
            """
            INSERT INTO event_organizers (event_id, team_member_id, volunteer_id)
            VALUES (?, ?, ?) RETURNING id
            """,
            (event_id, team_member_id, volunteer_id),
        ).fetchone()["id"]
    db.commit()
    return _organizer_model(_organizer_row(db, event_id, organizer_id))


@router.delete(
    "/organizers/{organizer_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_event_organizer(
    event_id: int, organizer_id: int, db: Connection
) -> Response:
    _organizer_row(db, event_id, organizer_id)
    db.execute("DELETE FROM event_organizers WHERE id = ?", (organizer_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/task-assignees", response_model=TaskAssigneeGroups)
def list_task_assignees(event_id: int, db: Connection) -> TaskAssigneeGroups:
    organizers = list_event_organizers(event_id, db)
    volunteers = db.execute(
        """
        SELECT volunteers.id, volunteers.name, volunteers.email
        FROM volunteers
        JOIN volunteer_signups
          ON volunteer_signups.volunteer_id = volunteers.id
         AND volunteer_signups.event_id = ?
         AND volunteer_signups.status = 'approved'
        WHERE NOT EXISTS (
            SELECT 1 FROM event_organizers
            WHERE event_id = ? AND volunteer_id = volunteers.id
        )
        ORDER BY volunteers.name
        """,
        (event_id, event_id),
    ).fetchall()
    return TaskAssigneeGroups(
        organizers=[
            EventPersonOption(
                person_type=organizer.person_type,
                person_id=organizer.person_id,
                name=organizer.name,
                email=organizer.email,
            )
            for organizer in organizers
        ],
        volunteers=[
            EventPersonOption(
                person_type="volunteer", person_id=row["id"],
                name=row["name"], email=row["email"],
            )
            for row in volunteers
        ],
    )
