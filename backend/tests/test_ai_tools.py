"""Tests for the AI tool dispatch/validation pipeline (TICKET-2/TICKET-3)."""

import json
import tempfile
import unittest
from pathlib import Path

from backend.ai_tools import TOOL_SPECS, dispatch_tool_call
from backend.database import connect, initialize_database


class AiToolsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        initialize_database(database_path)
        self.db = connect(database_path)

    def tearDown(self) -> None:
        self.db.close()
        self.temporary_directory.cleanup()

    def create_template(self) -> int:
        row = self.db.execute(
            "INSERT INTO event_templates (name, description) VALUES (?, ?) RETURNING id",
            ("Wellness", "A wellness event"),
        ).fetchone()
        self.db.commit()
        return row["id"]

    # -- tool spec surface -------------------------------------------------

    def create_volunteer(self, **overrides) -> int:
        self._volunteer_counter = getattr(self, "_volunteer_counter", 0) + 1
        fields = {
            "name": "Devi Suresh",
            "contact_number": f"+6585670{self._volunteer_counter:03d}",
            "email": f"volunteer{self._volunteer_counter}@example.com",
            "signup_status": "approved",
        }
        fields.update(overrides)
        row = self.db.execute(
            """
            INSERT INTO volunteers (name, contact_number, email, signup_status)
            VALUES (?, ?, ?, ?)
            RETURNING id
            """,
            (fields["name"], fields["contact_number"], fields["email"], fields["signup_status"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    def add_volunteer_skill(self, volunteer_id: int, skill_name: str) -> None:
        skill_id = self.db.execute(
            "INSERT INTO skills (name) VALUES (?) RETURNING id", (skill_name,)
        ).fetchone()["id"]
        self.db.execute(
            "INSERT INTO volunteer_skills (volunteer_id, skill_id) VALUES (?, ?)",
            (volunteer_id, skill_id),
        )
        self.db.commit()

    def test_tool_specs_expose_exactly_the_named_tool_set(self) -> None:
        names = {spec["function"]["name"] for spec in TOOL_SPECS}
        self.assertEqual(
            names,
            {
                "create_event_draft",
                "publish_event",
                "update_event",
                "get_event",
                "list_events",
                "cancel_event",
                "list_event_templates",
                "list_volunteers",
            },
        )

    def test_tool_specs_never_include_delete_event(self) -> None:
        names = {spec["function"]["name"] for spec in TOOL_SPECS}
        self.assertNotIn("delete_event", names)

    # -- create_event_draft --------------------------------------------

    def test_create_event_draft_does_not_write_to_the_database(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "create_event_draft",
            {"event_template_id": None, "name": "Test", "venue": "Hub", "event_date": "2099-01-01"},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["status"], "draft")
        total = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.assertEqual(total, 0)

    def test_create_event_draft_rejects_missing_required_field(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "create_event_draft",
            {"event_template_id": None, "venue": "Hub", "event_date": "2099-01-01"},
        )
        self.assertFalse(result["success"])
        self.assertIn("name", result["reason"])
        total = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.assertEqual(total, 0)

    def test_create_event_draft_rejects_a_missing_template_before_any_write(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "create_event_draft",
            {"event_template_id": 999, "name": "Test", "venue": "Hub", "event_date": "2099-01-01"},
        )
        self.assertFalse(result["success"])
        self.assertIn("not found", result["reason"])

    def test_create_event_draft_rejects_unknown_arguments(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "create_event_draft",
            {
                "event_template_id": None,
                "name": "Test",
                "venue": "Hub",
                "event_date": "2099-01-01",
                "run_sql": "DROP TABLE events",
            },
        )
        self.assertFalse(result["success"])

    # -- publish_event ---------------------------------------------------

    def test_publish_event_creates_a_real_event(self) -> None:
        template_id = self.create_template()
        result = dispatch_tool_call(
            self.db,
            "publish_event",
            {
                "event_template_id": template_id,
                "name": "August Wellness Session",
                "venue": "Tampines Hub",
                "event_date": "2099-01-01",
            },
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["name"], "August Wellness Session")
        total = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.assertEqual(total, 1)

    # -- get_event / list_events / update_event ---------------------------

    def _publish(self, **overrides) -> dict:
        args = {
            "event_template_id": None,
            "name": "Test",
            "venue": "Hub",
            "event_date": "2099-01-01",
        }
        args.update(overrides)
        result = dispatch_tool_call(self.db, "publish_event", args)
        self.assertTrue(result["success"], result)
        return result["result"]

    def test_get_event_returns_the_published_event(self) -> None:
        event = self._publish()
        result = dispatch_tool_call(self.db, "get_event", {"event_id": event["id"]})
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["id"], event["id"])

    def test_get_event_missing_id_is_a_structured_error_not_an_exception(self) -> None:
        result = dispatch_tool_call(self.db, "get_event", {"event_id": 9999})
        self.assertEqual(result, {"success": False, "reason": "Event 9999 was not found"})

    def test_list_events_returns_only_matching_events(self) -> None:
        self._publish(name="Included", event_date="2099-01-01")
        self._publish(name="Excluded", event_date="2000-01-01")
        result = dispatch_tool_call(self.db, "list_events", {"date_from": "2050-01-01"})
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Included"])

    def test_update_event_partially_updates_only_given_fields(self) -> None:
        event = self._publish(venue="Old Venue")
        result = dispatch_tool_call(
            self.db, "update_event", {"event_id": event["id"], "venue": "New Venue"}
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["venue"], "New Venue")
        self.assertEqual(result["result"]["name"], event["name"])

    def test_update_event_missing_id_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "update_event", {"event_id": 9999, "venue": "X"})
        self.assertFalse(result["success"])

    # -- cancel_event: the tool the proposal is strictest about -----------

    def test_cancel_event_sets_is_cancelled_and_closes_registration(self) -> None:
        event = self._publish()
        result = dispatch_tool_call(self.db, "cancel_event", {"event_id": event["id"]})
        self.assertTrue(result["success"])
        self.assertTrue(result["result"]["is_cancelled"])
        self.assertEqual(result["result"]["status"], "closed")

    def test_cancel_event_never_hard_deletes_the_row(self) -> None:
        event = self._publish()
        dispatch_tool_call(self.db, "cancel_event", {"event_id": event["id"]})
        row = self.db.execute(
            "SELECT 1 FROM events WHERE id = ?", (event["id"],)
        ).fetchone()
        self.assertIsNotNone(row)

    def test_cancel_event_missing_id_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "cancel_event", {"event_id": 9999})
        self.assertFalse(result["success"])

    # -- dispatch-level guards --------------------------------------------

    def test_unknown_tool_name_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "delete_event", {"event_id": 1})
        self.assertEqual(
            result, {"success": False, "reason": "Unknown tool 'delete_event'"}
        )

    # -- list_event_templates (TICKET-12) ----------------------------------

    def test_list_event_templates_returns_id_and_name(self) -> None:
        template_id = self.create_template()
        result = dispatch_tool_call(self.db, "list_event_templates", {})
        self.assertTrue(result["success"])
        names = {item["name"]: item["id"] for item in result["result"]["items"]}
        self.assertEqual(names["Wellness"], template_id)

    def test_list_event_templates_filters_by_search_text(self) -> None:
        self.create_template()
        result = dispatch_tool_call(
            self.db, "list_event_templates", {"q": "does not exist"}
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["items"], [])

    def test_list_event_templates_rejects_unknown_arguments(self) -> None:
        result = dispatch_tool_call(
            self.db, "list_event_templates", {"run_sql": "DROP TABLE event_templates"}
        )
        self.assertFalse(result["success"])

    def test_unknown_tool_name_never_touches_the_database(self) -> None:
        # There is deliberately no "execute_sql"/"run_code" tool at all —
        # dispatch_tool_call must reject it by name before any lookup.
        result = dispatch_tool_call(self.db, "execute_sql", {"query": "DROP TABLE events"})
        self.assertFalse(result["success"])

    # -- list_volunteers (TICKET-16) ---------------------------------------

    def test_list_volunteers_returns_a_volunteer_with_skills_and_counts(self) -> None:
        volunteer_id = self.create_volunteer(name="Devi Suresh")
        self.add_volunteer_skill(volunteer_id, "First Aid")
        result = dispatch_tool_call(self.db, "list_volunteers", {})
        self.assertTrue(result["success"])
        items = result["result"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Devi Suresh")
        self.assertEqual(items[0]["skills"], ["First Aid"])
        self.assertEqual(items[0]["counts"]["events_signed_up"], 0)

    def test_list_volunteers_filters_by_signup_status(self) -> None:
        self.create_volunteer(
            name="Approved Vol", email="approved@example.com", signup_status="approved"
        )
        self.create_volunteer(
            name="Pending Vol", email="pending@example.com", signup_status="pending"
        )
        result = dispatch_tool_call(self.db, "list_volunteers", {"signup_status": "approved"})
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Approved Vol"])

    def test_list_volunteers_filters_by_search_text(self) -> None:
        self.create_volunteer(name="Devi Suresh")
        result = dispatch_tool_call(self.db, "list_volunteers", {"q": "does not exist"})
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["items"], [])

    def test_list_volunteers_rejects_unknown_arguments(self) -> None:
        result = dispatch_tool_call(self.db, "list_volunteers", {"run_sql": "DROP TABLE volunteers"})
        self.assertFalse(result["success"])

    # -- audit log (TICKET-4) ----------------------------------------------

    def audit_rows(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT tool_name, arguments, success, entity_id, reason "
            "FROM ai_audit_log ORDER BY id"
        ).fetchall()
        return [dict(row) for row in rows]

    def test_successful_dispatch_writes_an_audit_row_with_the_entity_id(self) -> None:
        template_id = self.create_template()
        dispatch_tool_call(
            self.db,
            "publish_event",
            {
                "event_template_id": template_id,
                "name": "August Wellness Session",
                "venue": "Tampines Hub",
                "event_date": "2099-01-01",
            },
        )
        rows = self.audit_rows()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["tool_name"], "publish_event")
        self.assertEqual(row["success"], 1)
        self.assertIsNotNone(row["entity_id"])
        self.assertIsNone(row["reason"])
        self.assertEqual(json.loads(row["arguments"])["name"], "August Wellness Session")

    def test_business_validation_failure_writes_an_audit_row_with_the_reason(self) -> None:
        dispatch_tool_call(
            self.db,
            "create_event_draft",
            {"event_template_id": 999, "name": "Test", "venue": "Hub", "event_date": "2099-01-01"},
        )
        rows = self.audit_rows()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["tool_name"], "create_event_draft")
        self.assertEqual(row["success"], 0)
        self.assertIsNone(row["entity_id"])
        self.assertIn("not found", row["reason"])

    def test_unknown_tool_name_still_writes_an_audit_row(self) -> None:
        dispatch_tool_call(self.db, "delete_event", {"event_id": 1})
        rows = self.audit_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["tool_name"], "delete_event")
        self.assertEqual(rows[0]["success"], 0)

    def test_draft_dispatch_is_still_audited_even_though_no_event_is_written(self) -> None:
        dispatch_tool_call(
            self.db,
            "create_event_draft",
            {"event_template_id": None, "name": "Test", "venue": "Hub", "event_date": "2099-01-01"},
        )
        rows = self.audit_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["tool_name"], "create_event_draft")
        self.assertEqual(rows[0]["success"], 1)


if __name__ == "__main__":
    unittest.main()
