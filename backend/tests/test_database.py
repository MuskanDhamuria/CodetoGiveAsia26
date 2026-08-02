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
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 9"
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
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 8"
                ).fetchone()[0]

            self.assertEqual(contact_number, "+6591234567")
            self.assertEqual(migration, 1)

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
