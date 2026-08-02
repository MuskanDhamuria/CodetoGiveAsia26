"""Tests for the AI tool dispatch/validation pipeline (TICKET-2/TICKET-3)."""

import json
import tempfile
import unittest
from datetime import date, timedelta
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
                "approve_event_signup",
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


if __name__ == "__main__":
    unittest.main()
