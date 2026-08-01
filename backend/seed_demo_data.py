"""Insert a handful of demo events for local manual testing.

Usage:

    python3 -m backend.seed_demo_data [database_path]

Creates a placeholder event template (organizer-side template management
isn't built yet) and a few events under it.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.database import DEFAULT_DATABASE_PATH, connect, initialize_database

DEMO_EVENTS = [
    (
        "Wellness Morning",
        "Tampines Hub",
        "Bring a water bottle and wear comfortable clothing.",
        "2026-08-15",
        "open",
    ),
    (
        "Digital Literacy Workshop",
        "Jurong Community Hall",
        "Bring your own phone if you have one; laptops will be provided.",
        "2026-08-22",
        "open",
    ),
    (
        "Essential Supplies Distribution",
        "Central Warehouse",
        "Please arrive 15 minutes early to queue.",
        "2026-08-29",
        "closed",
    ),
    (
        "National Day Celebration 2026",
        "Marina Bay Community Plaza",
        "Free food and performances for all attendees.",
        "2026-07-09",
        "closed",
    ),
]


def seed(database_path: str | Path = DEFAULT_DATABASE_PATH) -> None:
    initialize_database(database_path)
    connection = connect(database_path)
    try:
        existing = connection.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        if existing:
            print(f"events table already has {existing} rows, skipping seed")
            return

        with connection:
            template_id = connection.execute(
                "INSERT INTO event_templates (name, description) VALUES (?, ?) RETURNING id",
                ("Demo seed template", "Placeholder template for local demo data."),
            ).fetchone()[0]
            connection.executemany(
                """
                INSERT INTO events
                    (event_template_id, name, venue, description, event_date, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [(template_id, *event) for event in DEMO_EVENTS],
            )
        print(f"seeded {len(DEMO_EVENTS)} events")
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo events")
    parser.add_argument(
        "database_path", nargs="?", type=Path, default=DEFAULT_DATABASE_PATH
    )
    args = parser.parse_args()
    seed(args.database_path)


if __name__ == "__main__":
    main()
