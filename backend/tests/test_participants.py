import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.database import connect
from backend.main import create_app


class ParticipantsEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def insert_template_and_event(self, **event_overrides) -> int:
        connection = connect(self.database_path)
        try:
            template_id = connection.execute(
                "INSERT INTO event_templates (name) VALUES (?) RETURNING id",
                ("Wellness",),
            ).fetchone()[0]
            fields = {
                "event_template_id": template_id,
                "name": "Wellness Morning",
                "venue": "Tampines Hub",
                "event_date": "2099-01-01",
                "status": "open",
            }
            fields.update(event_overrides)
            event_id = connection.execute(
                """
                INSERT INTO events (event_template_id, name, venue, event_date, status)
                VALUES (:event_template_id, :name, :venue, :event_date, :status)
                RETURNING id
                """,
                fields,
            ).fetchone()[0]
            connection.commit()
            return event_id
        finally:
            connection.close()

    def test_create_participant(self) -> None:
        response = self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "+6591234567", "email": "alice@example.com"},
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["name"], "Alice")
        self.assertEqual(body["contact_number"], "+6591234567")

    def test_create_participant_rejects_duplicate_contact_number(self) -> None:
        self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "+6591234567"},
        )

        response = self.client.post(
            "/api/v1/participants",
            json={"name": "Someone else", "contact_number": "+6591234567"},
        )

        self.assertEqual(response.status_code, 409)

    def test_get_participant_not_found(self) -> None:
        response = self.client.get("/api/v1/participants/999")
        self.assertEqual(response.status_code, 404)

    def test_get_participant(self) -> None:
        created = self.client.post(
            "/api/v1/participants", json={"name": "Alice"}
        ).json()

        response = self.client.get(f"/api/v1/participants/{created['id']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Alice")

    def test_list_participants_searches_by_name(self) -> None:
        self.client.post("/api/v1/participants", json={"name": "Alice Tan"})
        self.client.post("/api/v1/participants", json={"name": "Bob Lee"})

        response = self.client.get("/api/v1/participants", params={"q": "Alice"})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["name"], "Alice Tan")

    def test_participant_events_requires_existing_participant(self) -> None:
        response = self.client.get("/api/v1/participants/999/events")
        self.assertEqual(response.status_code, 404)

    def test_participant_events_returns_only_rsvped_events(self) -> None:
        rsvped_event_id = self.insert_template_and_event(name="Signed up for this one")
        self.insert_template_and_event(name="Never signed up for this one")

        participant = self.client.post(
            "/api/v1/participants", json={"name": "Bob", "contact_number": "+6598765432"}
        ).json()

        self.client.post(
            f"/api/v1/events/{rsvped_event_id}/participants",
            json={"participant_id": participant["id"]},
        )

        response = self.client.get(f"/api/v1/participants/{participant['id']}/events")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["name"], "Signed up for this one")
        self.assertTrue(body["items"][0]["rsvp_status"])


if __name__ == "__main__":
    unittest.main()
