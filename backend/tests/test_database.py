import tempfile
import unittest
from pathlib import Path

from backend.database import MIGRATIONS_PATH, connect, initialize_database
from backend.seed import seed


class DatabaseMigrationTest(unittest.TestCase):
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
