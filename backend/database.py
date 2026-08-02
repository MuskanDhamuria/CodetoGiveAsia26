"""Small SQLite bootstrap utility.

The project deliberately uses Python's standard-library sqlite3 module, so the
schema can be created without installing a database driver or running a server.
"""

from __future__ import annotations

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


MIGRATIONS_PATH = Path(__file__).with_name("migrations")
SCHEMA_PATH = MIGRATIONS_PATH / "001_initial_schema.sql"
DEFAULT_DATABASE_PATH = Path(__file__).with_name("data") / "passion_to_serve.sqlite3"


def connect(database_path: str | Path) -> sqlite3.Connection:
    """Open a connection with SQLite foreign-key enforcement enabled."""

    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.row_factory = sqlite3.Row
    return connection


def _repair_event_columns_before_optional_template(
    connection: sqlite3.Connection,
) -> None:
    """Repair databases where the old migration 002 removed later columns.

    Migration 002 existed briefly on the organizer branch with a table rebuild
    that only copied the original event columns. A database that had already
    applied migrations 003 and 005 could therefore retain their version records
    while losing their columns. Restore any missing columns before migration 006
    performs the final, column-preserving rebuild.
    """

    table_exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'"
    ).fetchone()
    if table_exists is None:
        return

    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(events)")
    }
    additions = {
        "beneficiary_id": (
            "ALTER TABLE events ADD COLUMN beneficiary_id INTEGER "
            "REFERENCES beneficiaries(id) ON DELETE SET NULL"
        ),
        "description": (
            "ALTER TABLE events ADD COLUMN description TEXT NOT NULL DEFAULT ''"
        ),
        "start_time": "ALTER TABLE events ADD COLUMN start_time TEXT",
        "end_time": "ALTER TABLE events ADD COLUMN end_time TEXT",
    }
    for name, statement in additions.items():
        if name not in columns:
            connection.execute(statement)

    connection.execute(
        """
        UPDATE events
        SET beneficiary_id = (
            SELECT id FROM beneficiaries WHERE name = 'Migrant workers'
        )
        WHERE beneficiary_id IS NULL
        """
    )
    connection.execute(
        """
        UPDATE events
        SET description = COALESCE(
            (
                SELECT description FROM event_templates
                WHERE event_templates.id = events.event_template_id
            ),
            ''
        )
        WHERE description = ''
        """
    )
    connection.commit()


def _repair_migration_seven_numbering_collision(connection: sqlite3.Connection) -> None:
    """Repair databases affected by two migrations briefly both named 007.

    ``008_whatsapp_bot.sql`` was originally numbered ``007_whatsapp_bot.sql``
    before ``007_skill_enhancement_template.sql`` was added and renumbering
    became necessary. A database that already applied the old
    007-numbered WhatsApp migration has ``schema_migrations`` recording
    version 7 as done — but that means the *other* version-7 migration
    (the skill-enhancement seed data) was silently skipped, and
    volunteer_signups.confirmed_at already exists, which would make this
    migration's own column addition fail with "duplicate column name".
    Both repairs are idempotent and safe to run on a fresh database too,
    where they are no-ops.
    """

    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(volunteer_signups)")
    }
    if "confirmed_at" not in columns:
        connection.execute("ALTER TABLE volunteer_signups ADD COLUMN confirmed_at TEXT")

    has_event_templates = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_templates'"
    ).fetchone()
    if has_event_templates is None:
        return
    has_skill_enhancement = connection.execute(
        "SELECT 1 FROM event_templates WHERE name = 'Skill Enhancement'"
    ).fetchone()
    if has_skill_enhancement is None:
        skill_enhancement_path = MIGRATIONS_PATH / "007_skill_enhancement_template.sql"
        if skill_enhancement_path.exists():
            connection.executescript(skill_enhancement_path.read_text(encoding="utf-8"))

    connection.commit()


def initialize_database(database_path: str | Path = DEFAULT_DATABASE_PATH) -> Path:
    """Create the database and apply pending SQL migrations in order."""

    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with closing(connect(path)) as connection:
        has_migrations_table = connection.execute(
            """
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'schema_migrations'
            """
        ).fetchone()
        applied_versions = (
            {
                row[0]
                for row in connection.execute(
                    "SELECT version FROM schema_migrations"
                ).fetchall()
            }
            if has_migrations_table
            else set()
        )
        for migration_path in sorted(MIGRATIONS_PATH.glob("[0-9][0-9][0-9]_*.sql")):
            version = int(migration_path.name.split("_", 1)[0])
            if version in applied_versions:
                continue
            if version == 6:
                _repair_event_columns_before_optional_template(connection)
            if version == 8:
                _repair_migration_seven_numbering_collision(connection)
            connection.executescript(migration_path.read_text(encoding="utf-8"))
            applied_versions.add(version)

    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize the SQLite database")
    parser.add_argument(
        "database_path",
        nargs="?",
        type=Path,
        default=DEFAULT_DATABASE_PATH,
        help=f"database file to create (default: {DEFAULT_DATABASE_PATH})",
    )
    args = parser.parse_args()
    print(initialize_database(args.database_path))


if __name__ == "__main__":
    main()
