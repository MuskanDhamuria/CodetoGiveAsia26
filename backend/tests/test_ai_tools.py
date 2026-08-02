"""Tests for the AI tool dispatch/validation pipeline (TICKET-2/TICKET-3)."""

import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from backend.ai_tools import TOOL_SPECS, dispatch_tool_call
from backend.api.routes import inventory as inventory_routes
from backend.bot import commands as bot_commands
from backend.database import connect, initialize_database
from backend.integrations import whatsapp_client
from backend.schema.inventory import StockAdjustment
from backend.tests.test_whatsapp import FakeWhatsAppClient


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

    def create_task(self, event_id: int, **overrides) -> int:
        if "position" not in overrides:
            overrides["position"] = self.db.execute(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM event_tasks WHERE event_id = ?",
                (event_id,),
            ).fetchone()[0]
        fields = {
            "name": "Recruit volunteers",
            "due_at": "2099-01-01",
            "category": "planning",
            "status": "incomplete",
            "team_member_id": None,
        }
        fields.update(overrides)
        row = self.db.execute(
            """
            INSERT INTO event_tasks
                (event_id, team_member_id, name, due_at, category, status, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                event_id,
                fields["team_member_id"],
                fields["name"],
                fields["due_at"],
                fields["category"],
                fields["status"],
                fields["position"],
            ),
        ).fetchone()
        self.db.commit()
        return row["id"]

    def create_team_member(
        self, *, name: str = "Priya Nair", email: str = "priya@example.org", is_active: bool = True
    ) -> int:
        row = self.db.execute(
            "INSERT INTO team_members (name, email, is_active) VALUES (?, ?, ?) RETURNING id",
            (name, email, 1 if is_active else 0),
        ).fetchone()
        self.db.commit()
        return row["id"]

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

    def create_event_with_role(self, role_name: str = "First Aid") -> dict:
        template_id = self.create_template()
        role_id = self.db.execute(
            "INSERT INTO roles (name, category) VALUES (?, ?) RETURNING id",
            (role_name, "volunteer"),
        ).fetchone()["id"]
        self.db.execute(
            "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
            (template_id, role_id),
        )
        self.db.commit()
        event = self._publish(event_template_id=template_id)
        return {"template_id": template_id, "role_id": role_id, "event": event}

    def create_signup(self, event_id: int, volunteer_id: int, **overrides) -> int:
        fields = {
            "status": "requested",
            "assigned_role_id": None,
            "is_leader": 0,
            "attendance": None,
        }
        fields.update(overrides)
        row = self.db.execute(
            """
            INSERT INTO volunteer_signups
                (event_id, volunteer_id, status, assigned_role_id, is_leader, attendance)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                event_id,
                volunteer_id,
                fields["status"],
                fields["assigned_role_id"],
                fields["is_leader"],
                fields["attendance"],
            ),
        ).fetchone()
        self.db.commit()
        return row["id"]

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
                "list_event_tasks",
                "assign_event_task",
                "update_task_status",
                "list_upcoming_deadlines",
                "list_event_roles",
                "list_event_signups",
                "list_pending_signups",
                "approve_event_signup",
                "list_inventory_items",
                "list_inventory_locations",
                "get_stock_levels",
                "list_inventory_movements",
                "preview_announcement",
                "send_announcement",
                "preview_shift_reminder",
                "send_shift_reminder",
                "list_completed_event_reports",
                "list_event_certificates",
                "preview_certificate_generation",
                "generate_event_certificates",
                "list_event_participants",
                "get_participant",
                "list_participants",
                "list_venues",
                "get_venue",
                "list_venue_bookings",
                "get_attendance_forecast",
                "get_event_logistics",
                "list_event_logistics_requirements",
                "create_event_task",
                "update_event_task",
                "create_inventory_item",
                "update_inventory_item",
                "create_inventory_location",
                "update_inventory_location",
                "adjust_stock",
                "transfer_stock",
                "create_venue",
                "update_venue",
                "create_venue_space",
                "update_venue_space",
                "create_venue_booking",
                "update_venue_booking",
                "create_event_logistics_requirement",
                "update_event_logistics_requirement",
                "cancel_event_logistics_requirement",
                "reserve_logistics_inventory",
                "release_logistics_inventory",
                "issue_logistics_inventory",
                "reconcile_logistics_allocation",
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

    def test_unexpected_executor_exception_becomes_a_structured_error(self) -> None:
        # TICKET-53: an unexpected failure inside an executor (e.g. a raw
        # sqlite3.OperationalError) must not propagate out of
        # dispatch_tool_call — it would otherwise kill the SSE stream
        # mid-turn with no error event at all.
        from backend.ai_tools import tools as ai_tools_module

        def boom(db, args):
            raise RuntimeError("simulated database failure")

        with patch.dict(ai_tools_module.TOOL_EXECUTORS, {"list_event_templates": boom}):
            result = dispatch_tool_call(self.db, "list_event_templates", {})

        self.assertFalse(result["success"])
        self.assertIn("simulated database failure", result["reason"])

        audit_row = self.db.execute(
            "SELECT tool_name, success, reason FROM ai_audit_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(audit_row["tool_name"], "list_event_templates")
        self.assertEqual(audit_row["success"], 0)
        self.assertIn("simulated database failure", audit_row["reason"])

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

    # -- list_event_tasks (TICKET-13) --------------------------------------

    def test_list_event_tasks_returns_tasks_for_the_event(self) -> None:
        event = self._publish()
        self.create_task(event["id"], name="Book venue")
        self.create_task(event["id"], name="Order supplies")
        result = dispatch_tool_call(self.db, "list_event_tasks", {"event_id": event["id"]})
        self.assertTrue(result["success"])
        names = {item["name"] for item in result["result"]["items"]}
        self.assertEqual(names, {"Book venue", "Order supplies"})

    def test_list_event_tasks_filters_by_category(self) -> None:
        event = self._publish()
        self.create_task(event["id"], name="Planning task", category="planning", position=0)
        self.create_task(event["id"], name="Execution task", category="execution", position=1)
        result = dispatch_tool_call(
            self.db, "list_event_tasks", {"event_id": event["id"], "category": "execution"}
        )
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Execution task"])

    def test_list_event_tasks_filters_by_status(self) -> None:
        event = self._publish()
        self.create_task(event["id"], name="Done task", status="done", position=0)
        self.create_task(event["id"], name="Open task", status="incomplete", position=1)
        result = dispatch_tool_call(
            self.db, "list_event_tasks", {"event_id": event["id"], "status": "done"}
        )
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Done task"])

    def test_list_event_tasks_missing_event_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "list_event_tasks", {"event_id": 9999})
        self.assertFalse(result["success"])

    def test_list_event_tasks_rejects_unknown_arguments(self) -> None:
        event = self._publish()
        result = dispatch_tool_call(
            self.db,
            "list_event_tasks",
            {"event_id": event["id"], "run_sql": "DROP TABLE event_tasks"},
        )
        self.assertFalse(result["success"])

    # -- create_event_task / update_event_task (TICKET-55) -----------------

    def test_create_event_task_writes_a_new_task(self) -> None:
        event = self._publish()

        result = dispatch_tool_call(
            self.db,
            "create_event_task",
            {
                "event_id": event["id"],
                "name": "Set up chairs",
                "due_at": "2099-01-01",
                "category": "planning",
            },
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["name"], "Set up chairs")
        total = self.db.execute(
            "SELECT COUNT(*) FROM event_tasks WHERE event_id = ?", (event["id"],)
        ).fetchone()[0]
        self.assertEqual(total, 1)

    def test_create_event_task_missing_event_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "create_event_task",
            {
                "event_id": 9999,
                "name": "Set up chairs",
                "due_at": "2099-01-01",
                "category": "planning",
            },
        )
        self.assertFalse(result["success"])

    def test_update_event_task_changes_fields(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])

        result = dispatch_tool_call(
            self.db,
            "update_event_task",
            {"event_id": event["id"], "task_id": task_id, "name": "Renamed task"},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["name"], "Renamed task")

    def test_update_event_task_missing_task_is_a_structured_error(self) -> None:
        event = self._publish()
        result = dispatch_tool_call(
            self.db,
            "update_event_task",
            {"event_id": event["id"], "task_id": 9999, "name": "Renamed task"},
        )
        self.assertFalse(result["success"])

    # -- assign_event_task (TICKET-14) -------------------------------------

    def test_assign_event_task_sets_the_team_member(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        member_id = self.create_team_member()
        result = dispatch_tool_call(
            self.db,
            "assign_event_task",
            {"event_id": event["id"], "task_id": task_id, "team_member_id": member_id},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["team_member_id"], member_id)

    def test_assign_event_task_unassigns_with_null(self) -> None:
        event = self._publish()
        member_id = self.create_team_member()
        task_id = self.create_task(event["id"], team_member_id=member_id)
        result = dispatch_tool_call(
            self.db,
            "assign_event_task",
            {"event_id": event["id"], "task_id": task_id, "team_member_id": None},
        )
        self.assertTrue(result["success"])
        self.assertIsNone(result["result"]["team_member_id"])

    def test_assign_event_task_rejects_an_inactive_team_member(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        member_id = self.create_team_member(is_active=False)
        result = dispatch_tool_call(
            self.db,
            "assign_event_task",
            {"event_id": event["id"], "task_id": task_id, "team_member_id": member_id},
        )
        self.assertFalse(result["success"])
        self.assertIn("Inactive", result["reason"])

    def test_assign_event_task_missing_team_member_is_a_structured_error(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        result = dispatch_tool_call(
            self.db,
            "assign_event_task",
            {"event_id": event["id"], "task_id": task_id, "team_member_id": 9999},
        )
        self.assertFalse(result["success"])

    def test_assign_event_task_rejects_unknown_arguments(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        result = dispatch_tool_call(
            self.db,
            "assign_event_task",
            {"event_id": event["id"], "task_id": task_id, "team_member_id": None, "run_sql": "x"},
        )
        self.assertFalse(result["success"])

    # -- update_task_status (TICKET-15) ------------------------------------

    def test_update_task_status_starts_a_task(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        result = dispatch_tool_call(
            self.db,
            "update_task_status",
            {"event_id": event["id"], "task_id": task_id, "status": "ongoing"},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["status"], "ongoing")

    def test_update_task_status_completes_a_task(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        result = dispatch_tool_call(
            self.db,
            "update_task_status",
            {"event_id": event["id"], "task_id": task_id, "status": "done"},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["status"], "done")

    def test_update_task_status_reopens_a_task(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"], status="done")
        result = dispatch_tool_call(
            self.db,
            "update_task_status",
            {"event_id": event["id"], "task_id": task_id, "status": "incomplete"},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["status"], "incomplete")

    def test_update_task_status_missing_task_is_a_structured_error(self) -> None:
        event = self._publish()
        result = dispatch_tool_call(
            self.db,
            "update_task_status",
            {"event_id": event["id"], "task_id": 9999, "status": "done"},
        )
        self.assertFalse(result["success"])

    def test_update_task_status_rejects_an_invalid_status_value(self) -> None:
        event = self._publish()
        task_id = self.create_task(event["id"])
        result = dispatch_tool_call(
            self.db,
            "update_task_status",
            {"event_id": event["id"], "task_id": task_id, "status": "cancelled"},
        )
        self.assertFalse(result["success"])

    # -- list_upcoming_deadlines (TICKET-17) -------------------------------

    def test_list_upcoming_deadlines_returns_tasks_due_within_the_window(self) -> None:
        event = self._publish()
        due_soon = (date.today() + timedelta(days=3)).isoformat()
        self.create_task(event["id"], name="Due soon", due_at=due_soon)
        result = dispatch_tool_call(self.db, "list_upcoming_deadlines", {})
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Due soon"])

    def test_list_upcoming_deadlines_excludes_done_tasks(self) -> None:
        event = self._publish()
        due_soon = (date.today() + timedelta(days=3)).isoformat()
        self.create_task(event["id"], name="Already done", due_at=due_soon, status="done")
        result = dispatch_tool_call(self.db, "list_upcoming_deadlines", {})
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["items"], [])

    def test_list_upcoming_deadlines_excludes_tasks_outside_the_window(self) -> None:
        event = self._publish()
        far_out = (date.today() + timedelta(days=90)).isoformat()
        self.create_task(event["id"], name="Far out", due_at=far_out)
        result = dispatch_tool_call(self.db, "list_upcoming_deadlines", {"days": 14})
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["items"], [])

    def test_list_upcoming_deadlines_filters_by_team_member(self) -> None:
        event = self._publish()
        member_id = self.create_team_member()
        due_soon = (date.today() + timedelta(days=3)).isoformat()
        self.create_task(event["id"], name="Assigned", due_at=due_soon, team_member_id=member_id)
        self.create_task(event["id"], name="Unassigned", due_at=due_soon, position=1)
        result = dispatch_tool_call(
            self.db, "list_upcoming_deadlines", {"team_member_id": member_id}
        )
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Assigned"])

    def test_list_upcoming_deadlines_rejects_unknown_arguments(self) -> None:
        result = dispatch_tool_call(self.db, "list_upcoming_deadlines", {"run_sql": "x"})
        self.assertFalse(result["success"])

    # -- list_event_roles / list_event_signups / approve_event_signup (TICKET-19/23) --

    def test_list_event_roles_returns_roles_available_for_the_event(self) -> None:
        fixture = self.create_event_with_role(role_name="First Aid")
        result = dispatch_tool_call(
            self.db, "list_event_roles", {"event_id": fixture["event"]["id"]}
        )
        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["First Aid"])

    def test_list_event_roles_missing_event_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "list_event_roles", {"event_id": 9999})
        self.assertFalse(result["success"])

    def test_list_event_signups_returns_signups_for_the_event(self) -> None:
        fixture = self.create_event_with_role()
        volunteer_id = self.create_volunteer()
        self.create_signup(fixture["event"]["id"], volunteer_id)
        result = dispatch_tool_call(
            self.db, "list_event_signups", {"event_id": fixture["event"]["id"]}
        )
        self.assertTrue(result["success"])
        items = result["result"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["volunteer_id"], volunteer_id)
        self.assertEqual(items[0]["status"], "requested")

    def test_list_event_signups_filters_by_status(self) -> None:
        fixture = self.create_event_with_role()
        pending = self.create_volunteer(name="Pending", email="pending@example.com")
        approved = self.create_volunteer(name="Approved", email="approved@example.com")
        self.create_signup(fixture["event"]["id"], pending, status="requested")
        self.create_signup(
            fixture["event"]["id"],
            approved,
            status="approved",
            assigned_role_id=fixture["role_id"],
        )
        result = dispatch_tool_call(
            self.db,
            "list_event_signups",
            {"event_id": fixture["event"]["id"], "status": "requested"},
        )
        self.assertTrue(result["success"])
        names = [item["volunteer_name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Pending"])

    # -- list_pending_signups (TICKET-37) -----------------------------------

    def test_list_pending_signups_spans_every_event(self) -> None:
        fixture_a = self.create_event_with_role(role_name="First Aid")
        fixture_b = self.create_event_with_role(role_name="Logistics")
        volunteer_a = self.create_volunteer(name="Volunteer A", email="a@example.com")
        volunteer_b = self.create_volunteer(name="Volunteer B", email="b@example.com")
        self.create_signup(fixture_a["event"]["id"], volunteer_a)
        self.create_signup(fixture_b["event"]["id"], volunteer_b)

        result = dispatch_tool_call(self.db, "list_pending_signups", {})

        self.assertTrue(result["success"])
        items = result["result"]["items"]
        event_ids = {item["event_id"] for item in items}
        self.assertEqual(event_ids, {fixture_a["event"]["id"], fixture_b["event"]["id"]})
        self.assertTrue(all(item.get("event_name") for item in items))

    def test_list_pending_signups_filters_by_status(self) -> None:
        fixture = self.create_event_with_role()
        pending = self.create_volunteer(name="Pending", email="pending@example.com")
        approved = self.create_volunteer(name="Approved", email="approved@example.com")
        self.create_signup(fixture["event"]["id"], pending, status="requested")
        self.create_signup(
            fixture["event"]["id"],
            approved,
            status="approved",
            assigned_role_id=fixture["role_id"],
        )

        result = dispatch_tool_call(self.db, "list_pending_signups", {"status": "requested"})

        self.assertTrue(result["success"])
        names = [item["volunteer_name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Pending"])

    def test_list_pending_signups_rejects_unknown_arguments(self) -> None:
        result = dispatch_tool_call(self.db, "list_pending_signups", {"event_id": 1})
        self.assertFalse(result["success"])

    def test_approve_event_signup_sets_status_and_role(self) -> None:
        fixture = self.create_event_with_role()
        volunteer_id = self.create_volunteer()
        signup_id = self.create_signup(fixture["event"]["id"], volunteer_id)
        result = dispatch_tool_call(
            self.db,
            "approve_event_signup",
            {
                "event_id": fixture["event"]["id"],
                "signup_id": signup_id,
                "assigned_role_id": fixture["role_id"],
            },
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["status"], "approved")
        self.assertEqual(result["result"]["assigned_role_id"], fixture["role_id"])

    def test_approve_event_signup_rejects_a_role_not_available_for_the_event(self) -> None:
        fixture = self.create_event_with_role()
        other_role_id = self.db.execute(
            "INSERT INTO roles (name, category) VALUES (?, ?) RETURNING id",
            ("Unrelated Role", "volunteer"),
        ).fetchone()["id"]
        self.db.commit()
        volunteer_id = self.create_volunteer()
        signup_id = self.create_signup(fixture["event"]["id"], volunteer_id)
        result = dispatch_tool_call(
            self.db,
            "approve_event_signup",
            {
                "event_id": fixture["event"]["id"],
                "signup_id": signup_id,
                "assigned_role_id": other_role_id,
            },
        )
        self.assertFalse(result["success"])

    def test_approve_event_signup_missing_signup_is_a_structured_error(self) -> None:
        fixture = self.create_event_with_role()
        result = dispatch_tool_call(
            self.db,
            "approve_event_signup",
            {
                "event_id": fixture["event"]["id"],
                "signup_id": 9999,
                "assigned_role_id": fixture["role_id"],
            },
        )
        self.assertFalse(result["success"])

    def test_approve_event_signup_rejects_unknown_arguments(self) -> None:
        fixture = self.create_event_with_role()
        volunteer_id = self.create_volunteer()
        signup_id = self.create_signup(fixture["event"]["id"], volunteer_id)
        result = dispatch_tool_call(
            self.db,
            "approve_event_signup",
            {
                "event_id": fixture["event"]["id"],
                "signup_id": signup_id,
                "assigned_role_id": fixture["role_id"],
                "run_sql": "x",
            },
        )
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


class AiToolsInventoryTest(unittest.TestCase):
    """TICKET-39: read-only inventory tools."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        initialize_database(database_path)
        self.db = connect(database_path)

    def tearDown(self) -> None:
        self.db.close()
        self.temporary_directory.cleanup()

    def create_item(self, **overrides) -> int:
        fields = {"name": "Bottled Water", "unit": "case", "item_type": "consumable"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO inventory_items (name, unit, item_type) VALUES (?, ?, ?) RETURNING id",
            (fields["name"], fields["unit"], fields["item_type"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    def create_location(self, **overrides) -> int:
        fields = {"name": "Main Store"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO inventory_locations (name) VALUES (?) RETURNING id", (fields["name"],)
        ).fetchone()
        self.db.commit()
        return row["id"]

    def test_list_inventory_items_returns_created_items(self) -> None:
        self.create_item(name="Bottled Water")
        self.create_item(name="First Aid Kit", item_type="reusable", unit="kit")
        result = dispatch_tool_call(self.db, "list_inventory_items", {})
        self.assertTrue(result["success"])
        names = {item["name"] for item in result["result"]["items"]}
        self.assertEqual(names, {"Bottled Water", "First Aid Kit"})

    def test_list_inventory_locations_returns_created_locations(self) -> None:
        self.create_location(name="Main Store")
        result = dispatch_tool_call(self.db, "list_inventory_locations", {})
        self.assertTrue(result["success"])
        names = {location["name"] for location in result["result"]["items"]}
        self.assertEqual(names, {"Main Store"})

    def test_get_stock_levels_reflects_an_adjustment_made_via_the_admin_route(self) -> None:
        item_id = self.create_item()
        location_id = self.create_location()
        # No AI tool performs adjustments yet (TICKET-39 is read-only) —
        # go through the admin route directly, same as an organizer would.
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=location_id, quantity_delta=10, reason="Initial stock"),
            self.db,
        )
        result = dispatch_tool_call(self.db, "get_stock_levels", {})
        self.assertTrue(result["success"])
        [row] = result["result"]["items"]
        self.assertEqual(row["item_id"], item_id)
        self.assertEqual(row["on_hand"], 10)
        self.assertEqual(row["available"], 10)

    def test_list_inventory_movements_reflects_an_adjustment(self) -> None:
        item_id = self.create_item()
        location_id = self.create_location()
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=location_id, quantity_delta=5, reason="Donation received"),
            self.db,
        )
        result = dispatch_tool_call(self.db, "list_inventory_movements", {})
        self.assertTrue(result["success"])
        [movement] = result["result"]["items"]
        self.assertEqual(movement["quantity_delta"], 5)
        self.assertEqual(movement["reason"], "Donation received")

    # -- TICKET-56: inventory writes --------------------------------------

    def test_create_inventory_item_writes_a_new_catalogue_row(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "create_inventory_item",
            {"name": "Bottled Water", "unit": "case", "item_type": "consumable"},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["name"], "Bottled Water")
        total = self.db.execute("SELECT COUNT(*) FROM inventory_items").fetchone()[0]
        self.assertEqual(total, 1)

    def test_update_inventory_item_changes_fields(self) -> None:
        item_id = self.create_item(name="Bottled Water")

        result = dispatch_tool_call(
            self.db, "update_inventory_item", {"item_id": item_id, "reorder_level": 20}
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["reorder_level"], 20)

    def test_update_inventory_item_missing_id_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(
            self.db, "update_inventory_item", {"item_id": 9999, "reorder_level": 5}
        )
        self.assertFalse(result["success"])

    def test_create_inventory_location_writes_a_new_row(self) -> None:
        result = dispatch_tool_call(
            self.db, "create_inventory_location", {"name": "Main Store"}
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["name"], "Main Store")

    def test_update_inventory_location_changes_fields(self) -> None:
        location_id = self.create_location(name="Main Store")

        result = dispatch_tool_call(
            self.db,
            "update_inventory_location",
            {"location_id": location_id, "address": "1 Depot Road"},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["address"], "1 Depot Road")

    def test_adjust_stock_increases_available_stock(self) -> None:
        item_id = self.create_item()
        location_id = self.create_location()

        result = dispatch_tool_call(
            self.db,
            "adjust_stock",
            {
                "item_id": item_id,
                "location_id": location_id,
                "quantity_delta": 10,
                "reason": "Initial stock",
            },
        )

        self.assertTrue(result["success"], result)
        stock = dispatch_tool_call(self.db, "get_stock_levels", {})
        [row] = stock["result"]["items"]
        self.assertEqual(row["available"], 10)

    def test_adjust_stock_rejects_a_zero_delta(self) -> None:
        item_id = self.create_item()
        location_id = self.create_location()

        result = dispatch_tool_call(
            self.db,
            "adjust_stock",
            {
                "item_id": item_id,
                "location_id": location_id,
                "quantity_delta": 0,
                "reason": "no-op",
            },
        )

        self.assertFalse(result["success"])

    def test_transfer_stock_moves_quantity_between_locations(self) -> None:
        item_id = self.create_item()
        source_id = self.create_location(name="Main Store")
        destination_id = self.create_location(name="Overflow Store")
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=source_id, quantity_delta=10, reason="Initial stock"),
            self.db,
        )

        result = dispatch_tool_call(
            self.db,
            "transfer_stock",
            {
                "item_id": item_id,
                "source_location_id": source_id,
                "destination_location_id": destination_id,
                "quantity": 4,
                "reason": "Move to overflow",
            },
        )

        self.assertTrue(result["success"], result)
        stock = dispatch_tool_call(self.db, "get_stock_levels", {})
        available_by_location = {row["location_id"]: row["available"] for row in stock["result"]["items"]}
        self.assertEqual(available_by_location[source_id], 6)
        self.assertEqual(available_by_location[destination_id], 4)

    def test_transfer_stock_rejects_insufficient_available_stock(self) -> None:
        item_id = self.create_item()
        source_id = self.create_location(name="Main Store")
        destination_id = self.create_location(name="Overflow Store")

        result = dispatch_tool_call(
            self.db,
            "transfer_stock",
            {
                "item_id": item_id,
                "source_location_id": source_id,
                "destination_location_id": destination_id,
                "quantity": 4,
                "reason": "Move to overflow",
            },
        )

        self.assertFalse(result["success"])


class AiToolsBroadcastAndReportsTest(AiToolsTest):
    """TICKET-40 (broadcast) and TICKET-41 (reports/certificates)."""

    def setUp(self) -> None:
        super().setUp()
        self.fake_whatsapp = FakeWhatsAppClient()
        self.get_client_patchers = [
            patch.object(whatsapp_client, "get_client", return_value=self.fake_whatsapp),
            patch.object(bot_commands, "get_client", return_value=self.fake_whatsapp),
        ]
        for patcher in self.get_client_patchers:
            patcher.start()

    def tearDown(self) -> None:
        for patcher in self.get_client_patchers:
            patcher.stop()
        super().tearDown()

    def create_participant(self, **overrides) -> int:
        fields = {"name": "Aisha Rahman", "contact_number": "+6591234567"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO participants (name, contact_number) VALUES (?, ?) RETURNING id",
            (fields["name"], fields["contact_number"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    def create_whatsapp_contact(self, phone_number: str, **overrides) -> int:
        fields = {"participant_id": None, "volunteer_id": None, "notify_new_events": 1}
        fields.update(overrides)
        row = self.db.execute(
            """
            INSERT INTO whatsapp_contacts
                (phone_number, participant_id, volunteer_id, notify_new_events)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (phone_number, fields["participant_id"], fields["volunteer_id"], fields["notify_new_events"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    # -- preview_announcement / send_announcement --------------------------

    def test_preview_announcement_does_not_write_or_send(self) -> None:
        event = self._publish()
        self.create_whatsapp_contact("+6590000001", notify_new_events=1)
        result = dispatch_tool_call(
            self.db,
            "preview_announcement",
            {"event_id": event["id"], "title": "Update", "body": "Bring water bottles", "audience": "all"},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["recipient_count"], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM announcements").fetchone()[0], 0)
        self.assertEqual(self.fake_whatsapp.sent, [])

    def test_preview_announcement_rejects_unknown_event(self) -> None:
        result = dispatch_tool_call(
            self.db,
            "preview_announcement",
            {"event_id": 9999, "title": "Update", "body": "Bring water bottles", "audience": "all"},
        )
        self.assertFalse(result["success"])
        self.assertIn("not found", result["reason"])

    def test_send_announcement_writes_and_sends_to_the_audience(self) -> None:
        event = self._publish()
        self.create_whatsapp_contact("+6590000001", notify_new_events=1)
        result = dispatch_tool_call(
            self.db,
            "send_announcement",
            {"event_id": event["id"], "title": "Update", "body": "Bring water bottles", "audience": "all"},
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["delivered_count"], 1)
        self.assertEqual(len(self.fake_whatsapp.sent), 1)
        self.assertEqual(self.fake_whatsapp.sent[0][0], "+6590000001")

    # -- preview_shift_reminder / send_shift_reminder -----------------------

    def test_preview_shift_reminder_defaults_the_body_and_targets_volunteers_only(self) -> None:
        fixture = self.create_event_with_role()
        volunteer_id = self.create_volunteer()
        self.create_signup(fixture["event"]["id"], volunteer_id, status="approved")
        self.create_whatsapp_contact("+6590000002", volunteer_id=volunteer_id)
        # A participant contact should not count toward a reminder's audience.
        self.create_whatsapp_contact("+6590000003", notify_new_events=1)
        result = dispatch_tool_call(
            self.db, "preview_shift_reminder", {"event_id": fixture["event"]["id"]}
        )
        self.assertTrue(result["success"])
        self.assertIn(fixture["event"]["name"], result["result"]["body"])
        self.assertEqual(result["result"]["audience"], "volunteers")
        self.assertEqual(result["result"]["recipient_count"], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM announcements").fetchone()[0], 0)

    def test_send_shift_reminder_sends_only_to_approved_volunteers(self) -> None:
        fixture = self.create_event_with_role()
        volunteer_id = self.create_volunteer()
        self.create_signup(fixture["event"]["id"], volunteer_id, status="approved")
        self.create_whatsapp_contact("+6590000002", volunteer_id=volunteer_id)
        result = dispatch_tool_call(
            self.db, "send_shift_reminder", {"event_id": fixture["event"]["id"]}
        )
        self.assertTrue(result["success"])
        self.assertEqual(len(self.fake_whatsapp.sent), 1)
        self.assertEqual(self.fake_whatsapp.sent[0][0], "+6590000002")

    # -- list_completed_event_reports ---------------------------------------

    def test_list_completed_event_reports_only_includes_closed_events(self) -> None:
        template_id = self.create_template()
        open_event = self._publish(name="Still Open", event_template_id=template_id)
        closed_event = self._publish(name="Wrapped Up", event_template_id=template_id)
        self.db.execute("UPDATE events SET status = 'closed' WHERE id = ?", (closed_event["id"],))
        self.db.commit()
        result = dispatch_tool_call(self.db, "list_completed_event_reports", {})
        self.assertTrue(result["success"])
        names = {item["name"] for item in result["result"]["items"]}
        self.assertIn("Wrapped Up", names)
        self.assertNotIn("Still Open", names)

    def test_list_completed_event_reports_omits_real_names_by_default(self) -> None:
        # TICKET-50: real participant/volunteer names must not be sent to
        # OpenRouter by default — only counts.
        template_id = self.create_template()
        event = self._publish(event_template_id=template_id)
        participant_id = self.create_participant(name="Aisha Rahman")
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) "
            "VALUES (?, ?, 1, 1)",
            (event["id"], participant_id),
        )
        self.db.execute("UPDATE events SET status = 'closed' WHERE id = ?", (event["id"],))
        self.db.commit()

        result = dispatch_tool_call(self.db, "list_completed_event_reports", {})

        self.assertTrue(result["success"])
        item = result["result"]["items"][0]
        self.assertNotIn("participant_names", item)
        self.assertNotIn("volunteer_names", item)
        self.assertEqual(item["attendees"], 1)

    def test_list_completed_event_reports_returns_names_when_explicitly_requested(self) -> None:
        template_id = self.create_template()
        event = self._publish(event_template_id=template_id)
        participant_id = self.create_participant(name="Aisha Rahman")
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) "
            "VALUES (?, ?, 1, 1)",
            (event["id"], participant_id),
        )
        self.db.execute("UPDATE events SET status = 'closed' WHERE id = ?", (event["id"],))
        self.db.commit()

        result = dispatch_tool_call(
            self.db, "list_completed_event_reports", {"include_names": True}
        )

        self.assertTrue(result["success"])
        item = result["result"]["items"][0]
        self.assertIn("Aisha Rahman", item["participant_names"])

    # -- preview_certificate_generation / generate_event_certificates -------

    def test_preview_certificate_generation_counts_eligible_attendees(self) -> None:
        event = self._publish()
        participant_id = self.create_participant()
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) VALUES (?, ?, 1, 1)",
            (event["id"], participant_id),
        )
        self.db.commit()
        result = dispatch_tool_call(
            self.db, "preview_certificate_generation", {"event_id": event["id"]}
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["eligible_participants"], 1)
        self.assertEqual(result["result"]["already_delivered"], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM certificates").fetchone()[0], 0)

    def test_generate_event_certificates_creates_and_delivers_a_certificate(self) -> None:
        event = self._publish()
        participant_id = self.create_participant()
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) VALUES (?, ?, 1, 1)",
            (event["id"], participant_id),
        )
        self.db.commit()
        self.create_whatsapp_contact("+6590000004", participant_id=participant_id)
        result = dispatch_tool_call(
            self.db, "generate_event_certificates", {"event_id": event["id"]}
        )
        self.assertTrue(result["success"])
        [certificate] = result["result"]["items"]
        self.assertEqual(certificate["participant_id"], participant_id)
        self.assertEqual(len(self.fake_whatsapp.sent), 1)

    # -- list_event_certificates ---------------------------------------------

    def test_list_event_certificates_returns_issued_certificates(self) -> None:
        event = self._publish()
        participant_id = self.create_participant()
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) VALUES (?, ?, 1, 1)",
            (event["id"], participant_id),
        )
        self.db.commit()
        dispatch_tool_call(self.db, "generate_event_certificates", {"event_id": event["id"]})
        result = dispatch_tool_call(self.db, "list_event_certificates", {"event_id": event["id"]})
        self.assertTrue(result["success"])
        self.assertEqual(len(result["result"]["items"]), 1)

    def test_list_event_certificates_never_includes_the_download_token_or_link(self) -> None:
        # TICKET-50: download_token/link are bearer-style secrets — the
        # model never needs them to answer a status/count question, and
        # sending them to OpenRouter would leak a real access credential.
        event = self._publish()
        participant_id = self.create_participant()
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) VALUES (?, ?, 1, 1)",
            (event["id"], participant_id),
        )
        self.db.commit()
        dispatch_tool_call(self.db, "generate_event_certificates", {"event_id": event["id"]})

        result = dispatch_tool_call(self.db, "list_event_certificates", {"event_id": event["id"]})

        item = result["result"]["items"][0]
        self.assertNotIn("download_token", item)
        self.assertNotIn("link", item)


class AiToolsParticipantsVenuesLogisticsTest(AiToolsTest):
    """TICKET-54: read-only AI tools for participants.py, venues.py, and

    logistics.py — previously zero AI coverage for any of the three.
    """

    def create_participant(self, **overrides) -> int:
        fields = {"name": "Aisha Rahman", "contact_number": "+6591234567"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO participants (name, contact_number) VALUES (?, ?) RETURNING id",
            (fields["name"], fields["contact_number"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    def create_venue(self, **overrides) -> int:
        fields = {"name": "Community Hub", "address": "1 Hub Way"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO venues (name, address, is_active) VALUES (?, ?, 1) RETURNING id",
            (fields["name"], fields["address"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    # -- participants ---------------------------------------------------

    def test_list_event_participants_returns_the_roster(self) -> None:
        event = self._publish()
        participant_id = self.create_participant(name="Aisha Rahman")
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status) VALUES (?, ?, 1)",
            (event["id"], participant_id),
        )
        self.db.commit()

        result = dispatch_tool_call(
            self.db, "list_event_participants", {"event_id": event["id"]}
        )

        self.assertTrue(result["success"])
        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Aisha Rahman"])

    def test_list_event_participants_filters_by_rsvp_status(self) -> None:
        event = self._publish()
        signed_up = self.create_participant(name="Signed Up", contact_number="+6591111111")
        cancelled = self.create_participant(name="Cancelled", contact_number="+6592222222")
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status) VALUES (?, ?, 1)",
            (event["id"], signed_up),
        )
        self.db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status) VALUES (?, ?, 0)",
            (event["id"], cancelled),
        )
        self.db.commit()

        result = dispatch_tool_call(
            self.db,
            "list_event_participants",
            {"event_id": event["id"], "rsvp_status": True},
        )

        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Signed Up"])

    def test_get_participant_returns_the_record(self) -> None:
        participant_id = self.create_participant(name="Aisha Rahman")

        result = dispatch_tool_call(self.db, "get_participant", {"participant_id": participant_id})

        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["name"], "Aisha Rahman")

    def test_get_participant_missing_id_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "get_participant", {"participant_id": 9999})

        self.assertFalse(result["success"])

    def test_list_participants_searches_by_name(self) -> None:
        self.create_participant(name="Aisha Rahman", contact_number="+6591111111")
        self.create_participant(name="Someone Else", contact_number="+6592222222")

        result = dispatch_tool_call(self.db, "list_participants", {"q": "Aisha"})

        names = [item["name"] for item in result["result"]["items"]]
        self.assertEqual(names, ["Aisha Rahman"])

    # -- venues -----------------------------------------------------------

    def test_list_venues_returns_created_venues(self) -> None:
        self.create_venue(name="Community Hub")

        result = dispatch_tool_call(self.db, "list_venues", {})

        names = [item["name"] for item in result["result"]["items"]]
        self.assertIn("Community Hub", names)

    def test_get_venue_returns_spaces_and_bookings(self) -> None:
        venue_id = self.create_venue(name="Community Hub")

        result = dispatch_tool_call(self.db, "get_venue", {"venue_id": venue_id})

        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["name"], "Community Hub")
        self.assertIn("bookings", result["result"])

    def test_get_venue_missing_id_is_a_structured_error(self) -> None:
        result = dispatch_tool_call(self.db, "get_venue", {"venue_id": 9999})

        self.assertFalse(result["success"])

    def test_list_venue_bookings_requires_an_existing_event(self) -> None:
        result = dispatch_tool_call(self.db, "list_venue_bookings", {"event_id": 9999})

        self.assertFalse(result["success"])

    # -- TICKET-57: venue writes -------------------------------------------

    def test_create_venue_writes_a_new_row(self) -> None:
        result = dispatch_tool_call(
            self.db, "create_venue", {"name": "Community Hub", "address": "1 Hub Way"}
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["name"], "Community Hub")

    def test_update_venue_changes_fields(self) -> None:
        venue_id = self.create_venue(name="Community Hub")

        result = dispatch_tool_call(
            self.db, "update_venue", {"venue_id": venue_id, "notes": "Has a ramp"}
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["notes"], "Has a ramp")

    def test_create_venue_space_writes_a_new_space(self) -> None:
        venue_id = self.create_venue(name="Community Hub")

        result = dispatch_tool_call(
            self.db,
            "create_venue_space",
            {"venue_id": venue_id, "name": "Main Hall", "pax_capacity": 100},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["name"], "Main Hall")

    def test_update_venue_space_changes_fields(self) -> None:
        venue_id = self.create_venue(name="Community Hub")
        space = dispatch_tool_call(
            self.db, "create_venue_space", {"venue_id": venue_id, "name": "Main Hall"}
        )["result"]

        result = dispatch_tool_call(
            self.db,
            "update_venue_space",
            {"venue_id": venue_id, "space_id": space["id"], "pax_capacity": 50},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["pax_capacity"], 50)

    def test_create_venue_booking_books_a_space_for_an_event(self) -> None:
        event = self._publish()
        venue_id = self.create_venue(name="Community Hub")
        space = dispatch_tool_call(
            self.db, "create_venue_space", {"venue_id": venue_id, "name": "Main Hall"}
        )["result"]

        result = dispatch_tool_call(
            self.db,
            "create_venue_booking",
            {
                "event_id": event["id"],
                "venue_space_id": space["id"],
                "status": "confirmed",
                "start_at": "2099-01-01T09:00:00",
                "end_at": "2099-01-01T12:00:00",
            },
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["venue_space_id"], space["id"])

    def test_create_venue_booking_rejects_an_overlapping_confirmed_booking(self) -> None:
        event = self._publish()
        other_event = self._publish(name="Other")
        venue_id = self.create_venue(name="Community Hub")
        space = dispatch_tool_call(
            self.db, "create_venue_space", {"venue_id": venue_id, "name": "Main Hall"}
        )["result"]
        dispatch_tool_call(
            self.db,
            "create_venue_booking",
            {
                "event_id": event["id"],
                "venue_space_id": space["id"],
                "status": "confirmed",
                "start_at": "2099-01-01T09:00:00",
                "end_at": "2099-01-01T12:00:00",
            },
        )

        result = dispatch_tool_call(
            self.db,
            "create_venue_booking",
            {
                "event_id": other_event["id"],
                "venue_space_id": space["id"],
                "status": "confirmed",
                "start_at": "2099-01-01T10:00:00",
                "end_at": "2099-01-01T13:00:00",
            },
        )

        self.assertFalse(result["success"])

    def test_update_venue_booking_changes_status(self) -> None:
        event = self._publish()
        venue_id = self.create_venue(name="Community Hub")
        space = dispatch_tool_call(
            self.db, "create_venue_space", {"venue_id": venue_id, "name": "Main Hall"}
        )["result"]
        booking = dispatch_tool_call(
            self.db,
            "create_venue_booking",
            {
                "event_id": event["id"],
                "venue_space_id": space["id"],
                "start_at": "2099-01-01T09:00:00",
                "end_at": "2099-01-01T12:00:00",
            },
        )["result"]

        result = dispatch_tool_call(
            self.db,
            "update_venue_booking",
            {"event_id": event["id"], "booking_id": booking["id"], "status": "cancelled"},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["status"], "cancelled")

    # -- logistics ----------------------------------------------------------

    def test_get_attendance_forecast_reports_insufficient_history_for_a_new_event(self) -> None:
        event = self._publish()

        result = dispatch_tool_call(self.db, "get_attendance_forecast", {"event_id": event["id"]})

        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["calculation_basis"], "insufficient_history")

    def test_get_event_logistics_bundles_forecast_requirements_and_bookings(self) -> None:
        event = self._publish()

        result = dispatch_tool_call(self.db, "get_event_logistics", {"event_id": event["id"]})

        self.assertTrue(result["success"])
        body = result["result"]
        self.assertIn("forecast", body)
        self.assertIn("requirements", body)
        self.assertIn("venue_bookings", body)
        self.assertIn("warnings", body)

    def test_list_event_logistics_requirements_returns_an_empty_list_for_a_fresh_event(self) -> None:
        event = self._publish()

        result = dispatch_tool_call(
            self.db, "list_event_logistics_requirements", {"event_id": event["id"]}
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["items"], [])

    # -- TICKET-58: logistics writes ----------------------------------------

    def create_goods_requirement(self, event_id: int, item_id: int, **overrides) -> dict:
        fields = {
            "requirement_type": "goods",
            "inventory_item_id": item_id,
            "required_quantity": 10,
            "unit": "case",
            "needed_by": "2099-01-01T00:00:00",
        }
        fields.update(overrides)
        result = dispatch_tool_call(
            self.db,
            "create_event_logistics_requirement",
            {"event_id": event_id, **fields},
        )
        self.assertTrue(result["success"], result)
        return result["result"]

    def create_inventory_item_row(self, **overrides) -> int:
        fields = {"name": "Bottled Water", "unit": "case", "item_type": "consumable"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO inventory_items (name, unit, item_type) VALUES (?, ?, ?) RETURNING id",
            (fields["name"], fields["unit"], fields["item_type"]),
        ).fetchone()
        self.db.commit()
        return row["id"]

    def create_inventory_location_row(self, **overrides) -> int:
        fields = {"name": "Main Store"}
        fields.update(overrides)
        row = self.db.execute(
            "INSERT INTO inventory_locations (name) VALUES (?) RETURNING id", (fields["name"],)
        ).fetchone()
        self.db.commit()
        return row["id"]

    def test_create_event_logistics_requirement_writes_a_new_row(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()

        requirement = self.create_goods_requirement(event["id"], item_id)

        self.assertEqual(requirement["required_quantity"], 10)

    def test_update_event_logistics_requirement_changes_fields(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        requirement = self.create_goods_requirement(event["id"], item_id)

        result = dispatch_tool_call(
            self.db,
            "update_event_logistics_requirement",
            {"event_id": event["id"], "requirement_id": requirement["id"], "required_quantity": 20},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["required_quantity"], 20)

    def test_cancel_event_logistics_requirement_marks_it_cancelled(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        requirement = self.create_goods_requirement(event["id"], item_id)

        result = dispatch_tool_call(
            self.db,
            "cancel_event_logistics_requirement",
            {"event_id": event["id"], "requirement_id": requirement["id"]},
        )

        self.assertTrue(result["success"], result)
        listed = dispatch_tool_call(
            self.db, "list_event_logistics_requirements", {"event_id": event["id"]}
        )
        [row] = listed["result"]["items"]
        self.assertTrue(row["is_cancelled"])

    def test_reserve_logistics_inventory_creates_an_allocation(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        location_id = self.create_inventory_location_row()
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=location_id, quantity_delta=10, reason="Initial stock"),
            self.db,
        )
        requirement = self.create_goods_requirement(event["id"], item_id)

        result = dispatch_tool_call(
            self.db,
            "reserve_logistics_inventory",
            {"event_id": event["id"], "requirement_id": requirement["id"], "location_id": location_id, "quantity": 5},
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["reserved_quantity"], 5)

    def test_reserve_logistics_inventory_rejects_insufficient_stock(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        location_id = self.create_inventory_location_row()
        requirement = self.create_goods_requirement(event["id"], item_id)

        result = dispatch_tool_call(
            self.db,
            "reserve_logistics_inventory",
            {"event_id": event["id"], "requirement_id": requirement["id"], "location_id": location_id, "quantity": 5},
        )

        self.assertFalse(result["success"])

    def test_release_logistics_inventory_reduces_the_reservation(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        location_id = self.create_inventory_location_row()
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=location_id, quantity_delta=10, reason="Initial stock"),
            self.db,
        )
        requirement = self.create_goods_requirement(event["id"], item_id)
        allocation = dispatch_tool_call(
            self.db,
            "reserve_logistics_inventory",
            {"event_id": event["id"], "requirement_id": requirement["id"], "location_id": location_id, "quantity": 5},
        )["result"]

        result = dispatch_tool_call(
            self.db,
            "release_logistics_inventory",
            {
                "event_id": event["id"],
                "requirement_id": requirement["id"],
                "allocation_id": allocation["id"],
                "quantity": 2,
            },
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["reserved_quantity"], 3)

    def test_issue_logistics_inventory_deducts_from_stock(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        location_id = self.create_inventory_location_row()
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=location_id, quantity_delta=10, reason="Initial stock"),
            self.db,
        )
        requirement = self.create_goods_requirement(event["id"], item_id)
        allocation = dispatch_tool_call(
            self.db,
            "reserve_logistics_inventory",
            {"event_id": event["id"], "requirement_id": requirement["id"], "location_id": location_id, "quantity": 5},
        )["result"]

        result = dispatch_tool_call(
            self.db,
            "issue_logistics_inventory",
            {
                "event_id": event["id"],
                "requirement_id": requirement["id"],
                "allocation_id": allocation["id"],
                "quantity": 5,
            },
        )

        self.assertTrue(result["success"], result)
        self.assertEqual(result["result"]["issued_quantity"], 5)

    def test_reconcile_logistics_allocation_requires_the_event_to_be_closed(self) -> None:
        event = self._publish()
        item_id = self.create_inventory_item_row()
        location_id = self.create_inventory_location_row()
        inventory_routes.adjust_stock(
            StockAdjustment(item_id=item_id, location_id=location_id, quantity_delta=10, reason="Initial stock"),
            self.db,
        )
        requirement = self.create_goods_requirement(event["id"], item_id)
        allocation = dispatch_tool_call(
            self.db,
            "reserve_logistics_inventory",
            {"event_id": event["id"], "requirement_id": requirement["id"], "location_id": location_id, "quantity": 5},
        )["result"]
        dispatch_tool_call(
            self.db,
            "issue_logistics_inventory",
            {
                "event_id": event["id"],
                "requirement_id": requirement["id"],
                "allocation_id": allocation["id"],
                "quantity": 5,
            },
        )

        result = dispatch_tool_call(
            self.db,
            "reconcile_logistics_allocation",
            {
                "event_id": event["id"],
                "requirement_id": requirement["id"],
                "allocation_id": allocation["id"],
                "consumed_quantity": 5,
            },
        )

        self.assertFalse(result["success"])


if __name__ == "__main__":
    unittest.main()
