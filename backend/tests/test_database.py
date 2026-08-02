import tempfile
import unittest
from pathlib import Path

from backend.database import MIGRATIONS_PATH, connect, initialize_database
from backend.seed import seed


class DatabaseMigrationTest(unittest.TestCase):
    def test_existing_events_receive_role_snapshots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "test.sqlite3"
            with connect(database_path) as connection:
                connection.executescript(
                    (MIGRATIONS_PATH / "001_initial_schema.sql").read_text(encoding="utf-8")
                )
                template_id = connection.execute(
                    "INSERT INTO event_templates (name) VALUES ('Existing template') RETURNING id"
                ).fetchone()[0]
                role_id = connection.execute(
                    "INSERT INTO roles (name, category) VALUES ('Registration', 'volunteer') RETURNING id"
                ).fetchone()[0]
                connection.execute(
                    "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
                    (template_id, role_id),
                )
                event_id = connection.execute(
                    """
                    INSERT INTO events (event_template_id, name, venue, event_date)
                    VALUES (?, 'Existing event', 'Hall', '2026-09-01') RETURNING id
                    """,
                    (template_id,),
                ).fetchone()[0]
                connection.commit()

            initialize_database(database_path)

            with connect(database_path) as connection:
                event_role = connection.execute(
                    "SELECT role_id FROM event_roles WHERE event_id = ?",
                    (event_id,),
                ).fetchone()
                migration = connection.execute(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 13"
                ).fetchone()[0]

            self.assertEqual(event_role[0], role_id)
            self.assertEqual(migration, 1)

    def test_existing_volunteer_phone_numbers_are_compacted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "test.sqlite3"
            with connect(database_path) as connection:
                connection.executescript(
                    (MIGRATIONS_PATH / "001_initial_schema.sql").read_text(encoding="utf-8")
                )
                connection.execute(
                    "INSERT INTO volunteers (name, contact_number) VALUES (?, ?)",
                    ("Existing Volunteer", "+65 9123-4567"),
                )
                connection.commit()

            initialize_database(database_path)

            with connect(database_path) as connection:
                contact_number = connection.execute(
                    "SELECT contact_number FROM volunteers WHERE name = ?",
                    ("Existing Volunteer",),
                ).fetchone()[0]
                migration = connection.execute(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 12"
                ).fetchone()[0]

            self.assertEqual(contact_number, "+6591234567")
            self.assertEqual(migration, 1)

    def test_inventory_migration_preserves_legacy_event_partners_and_reports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "legacy.sqlite3"
            with connect(database_path) as connection:
                for migration_path in sorted(MIGRATIONS_PATH.glob("[0-9][0-9][0-7]_*.sql")):
                    connection.executescript(migration_path.read_text(encoding="utf-8"))
                template_id = connection.execute(
                    "INSERT INTO event_templates (name) VALUES ('Legacy template') RETURNING id"
                ).fetchone()[0]
                event_id = connection.execute(
                    """INSERT INTO events (event_template_id, name, venue, event_date, status)
                       VALUES (?, 'Legacy Event', 'Old Hall', '2026-07-01', 'closed') RETURNING id""",
                    (template_id,),
                ).fetchone()[0]
                connection.execute(
                    "INSERT INTO event_partners (event_id, name) VALUES (?, 'Care Network')",
                    (event_id,),
                )
                connection.execute(
                    "INSERT INTO event_reports (event_id, status) VALUES (?, 'complete')",
                    (event_id,),
                )

            initialize_database(database_path)
            with connect(database_path) as connection:
                migrated = connection.execute(
                    """SELECT external_organizations.name, event_organizations.event_id
                       FROM external_organizations
                       JOIN event_organizations ON event_organizations.organization_id = external_organizations.id"""
                ).fetchone()
                report = connection.execute(
                    "SELECT status FROM event_reports WHERE event_id = ?", (event_id,)
                ).fetchone()
                expected_column = {
                    row["name"] for row in connection.execute("PRAGMA table_info(events)")
                }

            self.assertEqual(dict(migrated), {"name": "Care Network", "event_id": event_id})
            self.assertEqual(report["status"], "complete")
            self.assertIn("expected_attendance", expected_column)

    def test_existing_volunteer_migration_versions_are_repaired(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "collision.sqlite3"
            with connect(database_path) as connection:
                connection.executescript(
                    (MIGRATIONS_PATH / "001_initial_schema.sql").read_text(encoding="utf-8")
                )
                connection.executescript(
                    (MIGRATIONS_PATH / "012_normalize_volunteer_phone_numbers.sql").read_text(encoding="utf-8")
                )
                connection.execute(
                    "UPDATE schema_migrations SET version = 8, name = ? WHERE version = 12",
                    ("008_normalize_volunteer_phone_numbers.sql",),
                )
                connection.executescript(
                    (MIGRATIONS_PATH / "013_event_roles.sql").read_text(encoding="utf-8")
                )
                connection.execute(
                    "UPDATE schema_migrations SET version = 9, name = ? WHERE version = 13",
                    ("009_event_roles.sql",),
                )
                connection.commit()

            initialize_database(database_path)

            with connect(database_path) as connection:
                migrations = dict(
                    connection.execute(
                        "SELECT version, name FROM schema_migrations WHERE version IN (8, 9, 12, 13)"
                    ).fetchall()
                )
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }

            self.assertEqual(migrations[8], "008_whatsapp_bot.sql")
            self.assertEqual(migrations[9], "inventory and logistics management")
            self.assertEqual(migrations[12], "012_normalize_volunteer_phone_numbers.sql")
            self.assertEqual(migrations[13], "013_event_roles.sql")
            self.assertIn("whatsapp_contacts", tables)
            self.assertIn("inventory_items", tables)

    def test_existing_otp_version_is_moved_before_phone_migration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "otp-collision.sqlite3"
            initialize_database(database_path)
            with connect(database_path) as connection:
                connection.execute(
                    "DELETE FROM schema_migrations WHERE version = 12"
                )
                connection.execute(
                    "UPDATE schema_migrations SET version = 12, name = ? WHERE version = 18",
                    ("012_volunteer_otp.sql",),
                )
                connection.commit()

            initialize_database(database_path)

            with connect(database_path) as connection:
                migrations = dict(connection.execute(
                    "SELECT version, name FROM schema_migrations WHERE version IN (12, 18)"
                ).fetchall())

            self.assertEqual(migrations[12], "012_normalize_volunteer_phone_numbers.sql")
            self.assertEqual(migrations[18], "018_volunteer_otp.sql")

    def test_skill_enhancement_is_created_once_and_seed_does_not_duplicate_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "test.sqlite3"
            initialize_database(database_path)
            with connect(database_path) as connection:
                seed(connection)

            # Application startup can initialize the same database repeatedly.
            initialize_database(database_path)
            with connect(database_path) as connection:
                templates = connection.execute(
                    """
                    SELECT id
                    FROM event_templates
                    WHERE name = 'Skill Enhancement' AND is_built_in = 1
                    """
                ).fetchall()
                task_count = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM template_tasks
                    WHERE event_template_id = ?
                    """,
                    (templates[0][0],),
                ).fetchone()[0]
                migration = connection.execute(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 7"
                ).fetchone()[0]

            self.assertEqual(len(templates), 1)
            self.assertEqual(task_count, 10)
            self.assertEqual(migration, 1)


if __name__ == "__main__":
    unittest.main()
