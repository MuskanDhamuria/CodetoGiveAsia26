import sqlite3
import unittest

from backend.database import SCHEMA_PATH, connect


class SchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = connect(":memory:")
        self.connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.connection.close()

    def insert_event(self) -> int:
        template_id = self.connection.execute(
            "INSERT INTO event_templates (name) VALUES (?) RETURNING id",
            ("Wellness",),
        ).fetchone()[0]
        return self.connection.execute(
            """
            INSERT INTO events (event_template_id, name, venue, event_date)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (template_id, "Yoga", "Tampines Hub", "2026-08-09"),
        ).fetchone()[0]

    def test_initial_schema_creates_all_domain_tables(self) -> None:
        tables = {
            row[0]
            for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        self.assertTrue(
            {
                "participants",
                "volunteers",
                "skills",
                "volunteer_skills",
                "volunteer_interests",
                "events",
                "event_templates",
                "team_members",
                "event_tasks",
                "event_subtasks",
                "template_tasks",
                "template_subtasks",
                "template_roles",
                "participations",
                "volunteer_signups",
                "roles",
                "volunteer_signup_role_preferences",
            }.issubset(tables)
        )

    def test_foreign_keys_are_enforced(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """
                INSERT INTO events (event_template_id, name, venue, event_date)
                VALUES (999, 'Event', 'Venue', '2026-08-09')
                """
            )

    def test_duplicate_signup_for_an_event_is_rejected(self) -> None:
        event_id = self.insert_event()
        volunteer_id = self.connection.execute(
            "INSERT INTO volunteers (name) VALUES ('Alex') RETURNING id"
        ).fetchone()[0]
        self.connection.execute(
            "INSERT INTO volunteer_signups (event_id, volunteer_id) VALUES (?, ?)",
            (event_id, volunteer_id),
        )

        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO volunteer_signups (event_id, volunteer_id) VALUES (?, ?)",
                (event_id, volunteer_id),
            )

    def test_invalid_enum_and_boolean_values_are_rejected(self) -> None:
        event_id = self.insert_event()

        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "UPDATE events SET status = 'cancelled' WHERE id = ?", (event_id,)
            )

        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO participants (name) VALUES ('Jamie')"
            )
            participant_id = self.connection.execute(
                "SELECT id FROM participants WHERE name = 'Jamie'"
            ).fetchone()[0]
            self.connection.execute(
                """
                INSERT INTO participations
                    (event_id, participant_id, rsvp_status)
                VALUES (?, ?, 2)
                """,
                (event_id, participant_id),
            )

    def test_schema_can_be_applied_twice(self) -> None:
        self.connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        count = self.connection.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 1"
        ).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
