import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import create_app


class EventOrganizerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def create_event(self) -> dict:
        response = self.client.post(
            "/api/v1/events",
            json={
                "event_template_id": None,
                "name": "Community wellness day",
                "venue": "Tampines Hub",
                "event_date": "2027-08-09",
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def create_approved_volunteer(self, event_id: int, role_id: int, name: str, phone: str) -> int:
        signup = self.client.post(
            f"/api/v1/public/events/{event_id}/volunteer-signups",
            json={
                "name": name,
                "contact_number": phone,
                "email": f"{name.lower().replace(' ', '.')}@example.org",
                "role_ids": [role_id],
            },
        )
        self.assertEqual(signup.status_code, 200)
        payload = signup.json()["signup"]
        approved = self.client.post(
            f"/api/v1/events/{event_id}/volunteer-signups/{payload['id']}/approve",
            json={"assigned_role_id": role_id},
        )
        self.assertEqual(approved.status_code, 200)
        return payload["volunteer_id"]

    def test_groups_event_organizers_above_volunteer_only_assignees(self) -> None:
        event = self.create_event()
        event_id = event["id"]
        staff = self.client.post(
            "/api/v1/team-members",
            json={"name": "Aisha Staff", "email": "aisha.staff@example.org"},
        ).json()

        task = self.client.post(
            f"/api/v1/events/{event_id}/tasks",
            json={
                "name": "Confirm programme",
                "due_at": "2027-08-01",
                "category": "planning",
                "team_member_id": staff["id"],
            },
        )
        self.assertEqual(task.status_code, 201)

        role = self.client.post(
            f"/api/v1/events/{event_id}/roles", json={"name": "Registration"}
        ).json()
        organizer_volunteer_id = self.create_approved_volunteer(
            event_id, role["id"], "Ben Organizer", "+6591111111"
        )
        volunteer_only_id = self.create_approved_volunteer(
            event_id, role["id"], "Priya Volunteer", "+6592222222"
        )
        promoted = self.client.post(
            f"/api/v1/events/{event_id}/organizers",
            json={"person_type": "volunteer", "person_id": organizer_volunteer_id},
        )
        self.assertEqual(promoted.status_code, 201)

        grouped = self.client.get(
            f"/api/v1/events/{event_id}/task-assignees"
        ).json()
        self.assertEqual(
            [person["name"] for person in grouped["organizers"]],
            ["Aisha Staff", "Ben Organizer"],
        )
        self.assertEqual(
            [person["name"] for person in grouped["volunteers"]],
            ["Priya Volunteer"],
        )

        reassigned = self.client.patch(
            f"/api/v1/events/{event_id}/tasks/{task.json()['id']}",
            json={"volunteer_id": volunteer_only_id},
        )
        self.assertEqual(reassigned.status_code, 200)
        self.assertIsNone(reassigned.json()["team_member_id"])
        self.assertEqual(reassigned.json()["volunteer_id"], volunteer_only_id)

    def test_task_accepts_multiple_people_and_leads(self) -> None:
        event_id = self.create_event()["id"]
        staff_id = self.client.post(
            "/api/v1/team-members",
            json={"name": "Aisha Staff", "email": "aisha.staff@example.org"},
        ).json()["id"]
        role_id = self.client.post(
            f"/api/v1/events/{event_id}/roles", json={"name": "Sorting"}
        ).json()["id"]
        volunteer_id = self.create_approved_volunteer(
            event_id, role_id, "Ben Volunteer", "+6593333333"
        )
        task_id = self.client.post(
            f"/api/v1/events/{event_id}/tasks",
            json={
                "name": "Sort donated items",
                "due_at": "2027-08-07",
                "category": "execution",
            },
        ).json()["id"]

        response = self.client.patch(
            f"/api/v1/events/{event_id}/tasks/{task_id}",
            json={
                "assignees": [
                    {"person_type": "team_member", "person_id": staff_id, "is_lead": True},
                    {"person_type": "volunteer", "person_id": volunteer_id, "is_lead": True},
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [person["name"] for person in response.json()["assignees"]],
            ["Aisha Staff", "Ben Volunteer"],
        )
        self.assertTrue(all(person["is_lead"] for person in response.json()["assignees"]))
        self.assertEqual(response.json()["team_member_id"], staff_id)


if __name__ == "__main__":
    unittest.main()
