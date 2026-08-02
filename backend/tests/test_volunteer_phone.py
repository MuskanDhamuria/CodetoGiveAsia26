import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import create_app


class VolunteerPhoneTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def register(self, phone: str = "+65 9123-4567"):
        return self.client.post(
            "/api/v1/volunteer-auth/register",
            json={
                "name": "Alice Volunteer",
                "contact_number": phone,
                "password": "Volunteer8",
            },
        )

    def create_event(self, name: str) -> int:
        response = self.client.post(
            "/api/v1/events",
            json={
                "event_template_id": None,
                "name": name,
                "venue": "Tampines Hub",
                "event_date": "2026-09-01",
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["id"]

    def test_registration_stores_canonical_phone_and_login_accepts_formatting(self) -> None:
        registered = self.register()
        self.assertEqual(registered.status_code, 201)
        self.assertEqual(registered.json()["volunteer"]["contact_number"], "+6591234567")

        logged_in = self.client.post(
            "/api/v1/volunteer-auth/login",
            json={"contact_number": "9123 4567", "password": "Volunteer8"},
        )
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(logged_in.json()["volunteer"]["contact_number"], "+6591234567")

    def test_registration_rejects_invalid_and_duplicate_numbers(self) -> None:
        invalid = self.register("+65 1234")
        self.assertEqual(invalid.status_code, 422)

        self.assertEqual(self.register().status_code, 201)
        duplicate = self.register("9123 4567")
        self.assertEqual(duplicate.status_code, 409)

    def test_public_event_signup_normalizes_and_reuses_phone(self) -> None:
        first_event = self.create_event("First event")
        second_event = self.create_event("Second event")

        first = self.client.post(
            f"/api/v1/public/events/{first_event}/volunteer-signups",
            json={
                "name": "Alice Volunteer",
                "contact_number": "9123 4567",
                "role_ids": [],
            },
        )
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json()["volunteer_created"])

        second = self.client.post(
            f"/api/v1/public/events/{second_event}/volunteer-signups",
            json={
                "name": "Alice Again",
                "contact_number": "+65 9123-4567",
                "role_ids": [],
            },
        )
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.json()["volunteer_created"])

        volunteers = self.client.get("/api/v1/volunteers").json()["items"]
        self.assertEqual(len(volunteers), 1)
        self.assertEqual(volunteers[0]["contact_number"], "+6591234567")

    def test_delete_volunteer_removes_account_and_event_signup(self) -> None:
        registered = self.register()
        self.assertEqual(registered.status_code, 201)
        volunteer_id = registered.json()["volunteer"]["volunteer_id"]
        event_id = self.create_event("Volunteer cleanup event")
        signup = self.client.post(
            f"/api/v1/public/events/{event_id}/volunteer-signups",
            json={
                "name": "Alice Volunteer",
                "contact_number": "+65 9123 4567",
                "role_ids": [],
            },
        )
        self.assertEqual(signup.status_code, 200)

        deleted = self.client.delete(f"/api/v1/volunteers/{volunteer_id}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(f"/api/v1/volunteers/{volunteer_id}").status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/v1/events/{event_id}/volunteer-signups").json()["total"],
            0,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/volunteer-auth/login",
                json={"contact_number": "+6591234567", "password": "Volunteer8"},
            ).status_code,
            401,
        )


if __name__ == "__main__":
    unittest.main()
