import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import create_app


class AdminApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def create_event(self) -> dict:
        template = self.client.post(
            "/api/v1/event-templates",
            json={"name": "Wellness", "description": "A wellness event"},
        ).json()
        task = self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks",
            json={
                "name": "Recruit volunteers",
                "relative_due_days": -14,
                "category": "planning",
            },
        ).json()
        self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks/{task['id']}/subtasks",
            json={"title": "Publish the call for volunteers"},
        )
        return self.client.post(
            "/api/v1/events",
            json={
                "event_template_id": template["id"],
                "name": "August Wellness Session",
                "venue": "Tampines Hub",
                "event_date": "2026-08-09",
            },
        ).json()

    def test_organizer_creates_event_from_template_workflow(self) -> None:
        event = self.create_event()
        detail = self.client.get(f"/api/v1/events/{event['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["tasks"][0]["name"], "Recruit volunteers")
        self.assertEqual(detail.json()["tasks"][0]["due_at"], "2026-07-26")
        self.assertEqual(
            detail.json()["tasks"][0]["subtasks"][0]["title"],
            "Publish the call for volunteers",
        )

    def test_organizer_manages_event_and_task_lifecycle(self) -> None:
        event = self.create_event()
        event_id = event["id"]
        task_id = event["tasks"][0]["id"]
        subtask_id = event["tasks"][0]["subtasks"][0]["id"]

        rescheduled = self.client.post(
            f"/api/v1/events/{event_id}/reschedule",
            json={"event_date": "2026-08-16", "shift_task_deadlines": True},
        )
        self.assertEqual(rescheduled.status_code, 200)
        self.assertEqual(rescheduled.json()["tasks"][0]["due_at"], "2026-08-02")

        started = self.client.post(
            f"/api/v1/events/{event_id}/tasks/{task_id}/start"
        )
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["status"], "ongoing")

        checked = self.client.patch(
            f"/api/v1/events/{event_id}/tasks/{task_id}/subtasks/{subtask_id}",
            json={"completed": True},
        )
        self.assertEqual(checked.status_code, 200)
        self.assertTrue(checked.json()["completed"])

        closed = self.client.post(f"/api/v1/events/{event_id}/close")
        self.assertEqual(closed.status_code, 200)
        self.assertEqual(closed.json()["status"], "closed")

    def test_organizer_manages_reusable_templates(self) -> None:
        original = self.client.post(
            "/api/v1/event-templates",
            json={"name": "Distribution", "description": "Original"},
        ).json()
        updated = self.client.patch(
            f"/api/v1/event-templates/{original['id']}",
            json={"description": "Updated workflow"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["description"], "Updated workflow")

        clone = self.client.post(
            f"/api/v1/event-templates/{original['id']}/clone",
            json={"name": "Distribution copy"},
        )
        self.assertEqual(clone.status_code, 201)
        self.assertFalse(clone.json()["is_built_in"])

        listed = self.client.get("/api/v1/event-templates?q=distribution")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["total"], 2)

        deleted = self.client.delete(
            f"/api/v1/event-templates/{clone.json()['id']}"
        )
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(
            self.client.get(
                f"/api/v1/event-templates/{clone.json()['id']}"
            ).status_code,
            404,
        )

    def test_organizer_assigns_event_tasks_to_team_members(self) -> None:
        event = self.create_event()
        task_id = event["tasks"][0]["id"]
        member = self.client.post(
            "/api/v1/team-members",
            json={"name": "Priya Nair", "email": "priya@example.org"},
        )
        self.assertEqual(member.status_code, 201)

        assigned = self.client.patch(
            f"/api/v1/events/{event['id']}/tasks/{task_id}",
            json={"team_member_id": member.json()["id"]},
        )
        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.json()["team_member_id"], member.json()["id"])

        work = self.client.get(
            f"/api/v1/team-members/{member.json()['id']}/tasks"
        )
        self.assertEqual(work.status_code, 200)
        self.assertEqual(work.json()["total"], 1)
        self.assertEqual(work.json()["items"][0]["event_id"], event["id"])

    def test_organizer_manages_participant_rsvp_and_attendance(self) -> None:
        event = self.create_event()
        participant = self.client.post(
            "/api/v1/participants",
            json={"name": "Jamie Lim", "email": "jamie@example.org"},
        )
        self.assertEqual(participant.status_code, 201)
        participant_id = participant.json()["id"]

        registered = self.client.post(
            f"/api/v1/events/{event['id']}/participants",
            json={"participant_id": participant_id, "rsvp_status": True},
        )
        self.assertEqual(registered.status_code, 201)
        self.assertTrue(registered.json()["rsvp_status"])

        attended = self.client.patch(
            f"/api/v1/events/{event['id']}/participants/{participant_id}",
            json={"attendance": True},
        )
        self.assertEqual(attended.status_code, 200)
        self.assertTrue(attended.json()["attendance"])

        history = self.client.get(f"/api/v1/participants/{participant_id}/events")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["total"], 1)
        self.assertTrue(history.json()["items"][0]["attendance"])

    def test_organizer_reads_event_progress_summary(self) -> None:
        event = self.create_event()
        task_id = event["tasks"][0]["id"]
        self.client.post(f"/api/v1/events/{event['id']}/tasks/{task_id}/complete")
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Jamie Lim"}
        ).json()
        self.client.post(
            f"/api/v1/events/{event['id']}/participants",
            json={"participant_id": participant["id"], "rsvp_status": True},
        )

        summary = self.client.get(f"/api/v1/events/{event['id']}/summary")
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.json()["tasks"]["total"], 1)
        self.assertEqual(summary.json()["tasks"]["done"], 1)
        self.assertEqual(summary.json()["participants"]["rsvp_yes"], 1)

        calendar = self.client.get("/api/v1/calendar/events?month=2026-08")
        self.assertEqual(calendar.status_code, 200)
        self.assertEqual(calendar.json()["items"][0]["id"], event["id"])

    def test_organizer_adds_reorders_and_removes_event_tasks(self) -> None:
        event = self.create_event()
        original_task_id = event["tasks"][0]["id"]
        added = self.client.post(
            f"/api/v1/events/{event['id']}/tasks",
            json={
                "name": "Send recap",
                "due_at": "2026-08-10",
                "category": "post_execution",
            },
        )
        self.assertEqual(added.status_code, 201)
        added_id = added.json()["id"]

        reordered = self.client.put(
            f"/api/v1/events/{event['id']}/tasks/order",
            json={"task_ids": [added_id, original_task_id]},
        )
        self.assertEqual(reordered.status_code, 200)
        self.assertEqual([task["id"] for task in reordered.json()], [added_id, original_task_id])

        removed = self.client.delete(
            f"/api/v1/events/{event['id']}/tasks/{added_id}"
        )
        self.assertEqual(removed.status_code, 204)
        tasks = self.client.get(f"/api/v1/events/{event['id']}/tasks")
        self.assertEqual(tasks.json()["total"], 1)

    def test_organizer_updates_filters_and_deletes_events(self) -> None:
        event = self.create_event()
        updated = self.client.patch(
            f"/api/v1/events/{event['id']}",
            json={"name": "Renamed Session", "venue": "Bedok Hub"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["venue"], "Bedok Hub")

        listed = self.client.get("/api/v1/events?q=renamed&date_from=2026-08-01")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["total"], 1)

        deleted = self.client.delete(f"/api/v1/events/{event['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(
            self.client.get(f"/api/v1/events/{event['id']}").status_code, 404
        )

    def test_organizer_edits_template_tasks(self) -> None:
        template = self.client.post(
            "/api/v1/event-templates", json={"name": "Custom template"}
        ).json()
        first = self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks",
            json={
                "name": "First",
                "relative_due_days": -7,
                "category": "planning",
            },
        ).json()
        second = self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks",
            json={
                "name": "Second",
                "relative_due_days": 0,
                "category": "execution",
            },
        ).json()
        renamed = self.client.patch(
            f"/api/v1/event-templates/{template['id']}/tasks/{first['id']}",
            json={"name": "Prepare"},
        )
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["name"], "Prepare")

        ordered = self.client.put(
            f"/api/v1/event-templates/{template['id']}/tasks/order",
            json={"task_ids": [second["id"], first["id"]]},
        )
        self.assertEqual(ordered.status_code, 200)
        self.assertEqual([task["id"] for task in ordered.json()], [second["id"], first["id"]])

        deleted = self.client.delete(
            f"/api/v1/event-templates/{template['id']}/tasks/{second['id']}"
        )
        self.assertEqual(deleted.status_code, 204)
        tasks = self.client.get(
            f"/api/v1/event-templates/{template['id']}/tasks"
        )
        self.assertEqual(tasks.json()["total"], 1)

    def test_organizer_manages_event_subtasks(self) -> None:
        event = self.create_event()
        task_id = event["tasks"][0]["id"]
        existing_id = event["tasks"][0]["subtasks"][0]["id"]
        added = self.client.post(
            f"/api/v1/events/{event['id']}/tasks/{task_id}/subtasks",
            json={"title": "Confirm final numbers"},
        )
        self.assertEqual(added.status_code, 201)

        ordered = self.client.put(
            f"/api/v1/events/{event['id']}/tasks/{task_id}/subtasks/order",
            json={"subtask_ids": [added.json()["id"], existing_id]},
        )
        self.assertEqual(ordered.status_code, 200)
        self.assertEqual(ordered.json()[0]["id"], added.json()["id"])

        deleted = self.client.delete(
            f"/api/v1/events/{event['id']}/tasks/{task_id}/subtasks/{existing_id}"
        )
        self.assertEqual(deleted.status_code, 204)

    def test_organizer_manages_template_subtasks(self) -> None:
        template = self.client.post(
            "/api/v1/event-templates", json={"name": "Checklist template"}
        ).json()
        task = self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks",
            json={
                "name": "Prepare",
                "relative_due_days": -7,
                "category": "planning",
            },
        ).json()
        first = self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks/{task['id']}/subtasks",
            json={"title": "First item"},
        ).json()
        second = self.client.post(
            f"/api/v1/event-templates/{template['id']}/tasks/{task['id']}/subtasks",
            json={"title": "Second item"},
        ).json()

        renamed = self.client.patch(
            f"/api/v1/event-templates/{template['id']}/tasks/{task['id']}/subtasks/{first['id']}",
            json={"title": "Updated item"},
        )
        self.assertEqual(renamed.status_code, 200)

        ordered = self.client.put(
            f"/api/v1/event-templates/{template['id']}/tasks/{task['id']}/subtasks/order",
            json={"subtask_ids": [second["id"], first["id"]]},
        )
        self.assertEqual(ordered.status_code, 200)
        self.assertEqual(ordered.json()[0]["id"], second["id"])

        detail = self.client.get(f"/api/v1/event-templates/{template['id']}")
        self.assertEqual(detail.json()["tasks"][0]["subtasks"][0]["id"], second["id"])


if __name__ == "__main__":
    unittest.main()
