"""Demo data for organizer and volunteer development, modelled on Passion to
Serve's Wellness and Distribution event use cases.

Run with:

    python3 -m backend.seed
"""

from __future__ import annotations

from datetime import date, timedelta

from backend.database import DEFAULT_DATABASE_PATH, connect, initialize_database

ROLE_CATEGORY = "volunteer"


def seed(db) -> None:
    for name, email in [
        ("John Tan", "john.tan@passiontoserve.org"),
        ("Priya Nair", "priya.nair@passiontoserve.org"),
        ("Marcus Lee", "marcus.lee@passiontoserve.org"),
        ("Aisha Rahman", "aisha.rahman@passiontoserve.org"),
    ]:
        db.execute(
            """
            INSERT OR IGNORE INTO team_members (name, email)
            VALUES (?, ?)
            """,
            (name, email),
        )

    if db.execute("SELECT COUNT(*) FROM events").fetchone()[0] > 0:
        print("Database already has Events; refreshed safe seed records only.")
        return

    role_ids = {
        name: db.execute(
            "INSERT INTO roles (name, category) VALUES (?, ?) RETURNING id",
            (name, ROLE_CATEGORY),
        ).fetchone()[0]
        for name in [
            "Wellness Instructor",
            "Setup Crew",
            "Registration",
            "Memory Capture",
            "Sorting Crew",
            "Collection Driver",
            "Warehouse Liaison",
        ]
    }

    skill_ids = {
        name: db.execute(
            "INSERT INTO skills (name) VALUES (?) RETURNING id", (name,)
        ).fetchone()[0]
        for name in [
            "First Aid",
            "Yoga Instruction",
            "Driving (Class 3)",
            "Photography",
            "Mandarin",
            "Tamil",
            "Event Setup",
            "Registration Desk",
        ]
    }

    volunteer_ids = {}
    for name, contact, email, status, skills in [
        ("John Tan", "+65 8123 4567", "john.tan@example.com", "approved", ["First Aid", "Event Setup"]),
        ("Priya Nair", "+65 8234 5678", "priya.nair@example.com", "approved", ["Photography", "Registration Desk"]),
        ("Marcus Lee", "+65 8345 6789", "marcus.lee@example.com", "approved", ["Driving (Class 3)", "Event Setup"]),
        ("Aisha Rahman", "+65 8456 7890", "aisha.rahman@example.com", "approved", ["Registration Desk", "Mandarin"]),
        ("Devi Suresh", "+65 8567 8901", "devi.suresh@example.com", "approved", ["Yoga Instruction", "Tamil"]),
        ("Wei Ming Koh", "+65 8678 9012", "weiming.koh@example.com", "approved", ["Driving (Class 3)"]),
        ("Farah Hassan", "+65 8789 0123", "farah.hassan@example.com", "pending", ["Registration Desk"]),
        ("Ben Ong", "+65 8890 1234", "ben.ong@example.com", "pending", ["Event Setup", "Photography"]),
    ]:
        volunteer_id = db.execute(
            """
            INSERT INTO volunteers (name, contact_number, email, signup_status)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (name, contact, email, status),
        ).fetchone()[0]
        volunteer_ids[name] = volunteer_id
        for skill in skills:
            db.execute(
                "INSERT INTO volunteer_skills (volunteer_id, skill_id) VALUES (?, ?)",
                (volunteer_id, skill_ids[skill]),
            )

    wellness_template_id = db.execute(
        """
        INSERT INTO event_templates (name, description, is_built_in)
        VALUES (?, ?, 1) RETURNING id
        """,
        ("Wellness – Yoga / Zumba / Meditation", "Run a focused wellbeing session for migrant workers."),
    ).fetchone()[0]
    for role_name in ["Wellness Instructor", "Setup Crew", "Registration", "Memory Capture"]:
        db.execute(
            "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
            (wellness_template_id, role_ids[role_name]),
        )
    wellness_tasks = [
        ("Align the team on holding the event", -56, "planning", None),
        ("Book the event venue", -42, "planning", None),
        ("Confirm the volunteer wellness instructor", -42, "planning", "Wellness Instructor"),
        ("Notify beneficiary migrant workers", -21, "planning", "Registration"),
        ("Set up the audio system", 0, "execution", "Setup Crew"),
        ("Capture event memories", 0, "execution", "Memory Capture"),
        ("Send volunteer acknowledgements", 3, "post_execution", None),
        ("Share the event recap on social media", 7, "post_execution", None),
    ]
    for position, (name, offset, category, role_name) in enumerate(wellness_tasks):
        db.execute(
            """
            INSERT INTO template_tasks
                (event_template_id, name, relative_due_days, category, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (wellness_template_id, name, offset, category, position),
        )

    distribution_template_id = db.execute(
        """
        INSERT INTO event_templates (name, description, is_built_in)
        VALUES (?, ?, 1) RETURNING id
        """,
        ("Distribution of pre-loved items", "Collect, sort, and distribute essential items."),
    ).fetchone()[0]
    for role_name in ["Registration", "Sorting Crew", "Collection Driver", "Warehouse Liaison", "Memory Capture"]:
        db.execute(
            "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
            (distribution_template_id, role_ids[role_name]),
        )
    distribution_tasks = [
        ("Align the team on holding the event", -56, "planning", None),
        ("Confirm collection venues and schedules", -42, "planning", None),
        ("Arrange collection transport", -35, "planning", "Collection Driver"),
        ("Arrange warehouse storage", -35, "planning", "Warehouse Liaison"),
        ("Notify beneficiary migrant workers", -21, "planning", "Registration"),
        ("Recruit volunteers", -14, "planning", None),
        ("Sort collected items", 0, "execution", "Sorting Crew"),
        ("Capture event memories", 0, "execution", "Memory Capture"),
        ("Send volunteer certificates", 3, "post_execution", None),
        ("Send volunteer acknowledgements", 3, "post_execution", None),
    ]
    for position, (name, offset, category, role_name) in enumerate(distribution_tasks):
        db.execute(
            """
            INSERT INTO template_tasks
                (event_template_id, name, relative_due_days, category, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (distribution_template_id, name, offset, category, position),
        )

    def create_event(template_id: int, template_tasks, name, venue, event_date, status):
        event_id = db.execute(
            """
            INSERT INTO events (event_template_id, name, venue, event_date, status)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """,
            (template_id, name, venue, event_date.isoformat(), status),
        ).fetchone()[0]
        task_ids = {}
        for position, (task_name, offset, category, _role_name) in enumerate(template_tasks):
            due_at = (event_date + timedelta(days=offset)).isoformat()
            task_id = db.execute(
                """
                INSERT INTO event_tasks
                    (event_id, name, due_at, category, status, position)
                VALUES (?, ?, ?, ?, 'incomplete', ?)
                RETURNING id
                """,
                (event_id, task_name, due_at, category, position),
            ).fetchone()[0]
            task_ids[task_name] = task_id
        return event_id, task_ids

    def mark_done(task_ids, *names):
        for name in names:
            db.execute("UPDATE event_tasks SET status = 'done' WHERE id = ?", (task_ids[name],))

    def sign_up(event_id, volunteer_name, role_name, status, is_leader=False, attendance=None):
        db.execute(
            """
            INSERT INTO volunteer_signups
                (event_id, volunteer_id, status, assigned_role_id, is_leader, attendance)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                volunteer_ids[volunteer_name],
                status,
                role_ids.get(role_name) if role_name else None,
                1 if is_leader else 0,
                attendance,
            ),
        )

    past_yoga_id, past_yoga_tasks = create_event(
        wellness_template_id, wellness_tasks,
        "Yoga at Tampines Hub", "Tampines Hub", date(2026, 6, 14), "closed",
    )
    mark_done(
        past_yoga_tasks,
        "Align the team on holding the event",
        "Book the event venue",
        "Confirm the volunteer wellness instructor",
        "Notify beneficiary migrant workers",
        "Set up the audio system",
        "Capture event memories",
        "Send volunteer acknowledgements",
    )
    sign_up(past_yoga_id, "Devi Suresh", "Wellness Instructor", "approved", is_leader=True, attendance=True)
    sign_up(past_yoga_id, "John Tan", "Setup Crew", "approved", attendance=True)
    sign_up(past_yoga_id, "Priya Nair", "Memory Capture", "approved", attendance=True)
    sign_up(past_yoga_id, "Farah Hassan", "Registration", "approved", attendance=False)

    zumba_id, zumba_tasks = create_event(
        wellness_template_id, wellness_tasks,
        "Zumba at Boon Lay Dormitory", "Boon Lay Dormitory", date(2026, 9, 12), "open",
    )
    mark_done(zumba_tasks, "Align the team on holding the event", "Confirm the volunteer wellness instructor")
    db.execute(
        "UPDATE event_tasks SET status = 'ongoing' WHERE id = ?", (zumba_tasks["Book the event venue"],)
    )
    sign_up(zumba_id, "Devi Suresh", "Wellness Instructor", "approved", is_leader=True)
    sign_up(zumba_id, "Marcus Lee", "Setup Crew", "requested")
    sign_up(zumba_id, "Ben Ong", "Memory Capture", "requested")
    sign_up(zumba_id, "Wei Ming Koh", None, "rejected")

    distribution_id, distribution_tasks_ids = create_event(
        distribution_template_id, distribution_tasks,
        "Clothes & Essentials Distribution", "Tuas Dormitory", date(2026, 8, 23), "open",
    )
    mark_done(distribution_tasks_ids, "Align the team on holding the event", "Confirm collection venues and schedules")
    sign_up(distribution_id, "John Tan", "Sorting Crew", "approved")
    sign_up(distribution_id, "Marcus Lee", "Collection Driver", "approved")
    sign_up(distribution_id, "Aisha Rahman", "Registration", "approved")
    sign_up(distribution_id, "Farah Hassan", "Warehouse Liaison", "requested")

    for participant_name, contact, email in [
        ("Kumar Selvam", "+65 9111 2222", "kumar.selvam@example.com"),
        ("Rizal Abdullah", "+65 9222 3333", "rizal.abdullah@example.com"),
        ("Htun Aung", "+65 9333 4444", "htun.aung@example.com"),
    ]:
        participant_id = db.execute(
            "INSERT INTO participants (name, contact_number, email) VALUES (?, ?, ?) RETURNING id",
            (participant_name, contact, email),
        ).fetchone()[0]
        for event_id, rsvp, attendance in [
            (past_yoga_id, True, True),
            (zumba_id, True, None),
            (distribution_id, False, None),
        ]:
            db.execute(
                """
                INSERT INTO participations (event_id, participant_id, rsvp_status, attendance)
                VALUES (?, ?, ?, ?)
                """,
                (event_id, participant_id, rsvp, attendance),
            )

    db.commit()
    print("Seeded demo data.")


def main() -> None:
    initialize_database(DEFAULT_DATABASE_PATH)
    with connect(DEFAULT_DATABASE_PATH) as db:
        seed(db)


if __name__ == "__main__":
    main()
