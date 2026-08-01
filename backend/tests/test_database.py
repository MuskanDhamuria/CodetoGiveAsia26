import tempfile
import unittest
from pathlib import Path

from backend.database import connect, initialize_database
from backend.seed import seed


class DatabaseMigrationTest(unittest.TestCase):
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
