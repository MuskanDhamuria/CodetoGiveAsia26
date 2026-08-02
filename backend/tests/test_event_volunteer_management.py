import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.database import connect
from backend.main import create_app
from backend.seed import seed


class EventVolunteerManagementTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()
        with connect(self.database_path) as database:
            seed(database)

        events = self.client.get("/api/v1/events").json()["items"]
        self.event_id = next(
            event["id"]
            for event in events
            if event["name"] == "Clothes & Essentials Distribution"
        )
        self.wellness_event_id = next(
            event["id"]
            for event in events
            if event["name"] == "Zumba at Boon Lay Dormitory"
        )
        self.other_wellness_event_id = next(
            event["id"]
            for event in events
            if event["name"] == "Yoga at Tampines Hub"
        )

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def test_signup_response_includes_event_role_preferences(self) -> None:
        roles = self.client.get(f"/api/v1/events/{self.event_id}/roles").json()
        preferred_role = roles[0]

        created = self.client.post(
            f"/api/v1/public/events/{self.event_id}/volunteer-signups",
            json={
                "name": "Preference Tester",
                "contact_number": "+6598765432",
                "role_ids": [preferred_role["id"]],
            },
        )

        self.assertEqual(created.status_code, 200)
        self.assertEqual(
            created.json()["signup"]["preferred_role_names"],
            [preferred_role["name"]],
        )
        volunteer_id = created.json()["signup"]["volunteer_id"]
        history = self.client.get(f"/api/v1/volunteers/{volunteer_id}/events")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(
            history.json()["items"][0]["preferred_role_names"],
            [preferred_role["name"]],
        )

    def test_assignment_and_attendance_can_be_cleared(self) -> None:
        signups = self.client.get(
            f"/api/v1/events/{self.event_id}/volunteer-signups"
        ).json()["items"]
        signup = next(item for item in signups if item["status"] == "approved")
        endpoint = f"/api/v1/events/{self.event_id}/volunteer-signups/{signup['id']}"

        recorded = self.client.patch(endpoint, json={"attendance": True})
        self.assertEqual(recorded.status_code, 200)
        self.assertTrue(recorded.json()["attendance"])

        cleared = self.client.patch(
            endpoint,
            json={"assigned_role_id": None, "is_leader": False, "attendance": None},
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()["assigned_role_id"])
        self.assertIsNone(cleared.json()["attendance"])

    def test_signup_can_be_approved_without_a_role(self) -> None:
        created = self.client.post(
            f"/api/v1/public/events/{self.event_id}/volunteer-signups",
            json={
                "name": "Unassigned Approval Tester",
                "contact_number": "+6591112233",
                "role_ids": [],
            },
        )
        self.assertEqual(created.status_code, 200)
        signup_id = created.json()["signup"]["id"]

        approved = self.client.post(
            f"/api/v1/events/{self.event_id}/volunteer-signups/{signup_id}/approve",
            json={"assigned_role_id": None},
        )

        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["status"], "approved")
        self.assertIsNone(approved.json()["assigned_role_id"])

    def test_event_role_changes_do_not_change_another_event(self) -> None:
        created = self.client.post(
            f"/api/v1/events/{self.wellness_event_id}/roles",
            json={"name": "Translation support"},
        )
        self.assertEqual(created.status_code, 201)

        selected_names = {
            role["name"]
            for role in self.client.get(f"/api/v1/events/{self.wellness_event_id}/roles").json()
        }
        other_names = {
            role["name"]
            for role in self.client.get(f"/api/v1/events/{self.other_wellness_event_id}/roles").json()
        }
        self.assertIn("Translation support", selected_names)
        self.assertNotIn("Translation support", other_names)

        removed = self.client.delete(
            f"/api/v1/events/{self.wellness_event_id}/roles/{created.json()['id']}"
        )
        self.assertEqual(removed.status_code, 204)

    def test_assigned_role_must_be_reassigned_before_removal(self) -> None:
        signups = self.client.get(
            f"/api/v1/events/{self.event_id}/volunteer-signups"
        ).json()["items"]
        assigned = next(item for item in signups if item["assigned_role_id"] is not None)

        response = self.client.delete(
            f"/api/v1/events/{self.event_id}/roles/{assigned['assigned_role_id']}"
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("Reassign", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
