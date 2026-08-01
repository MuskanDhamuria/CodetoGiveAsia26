import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import create_app


class EventsEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def insert_template_and_event(self, **event_overrides) -> int:
        from backend.database import connect

        connection = connect(self.client_context.app.state.database_path)
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
                "start_time": "09:00",
                "status": "open",
            }
            fields.update(event_overrides)
            event_id = connection.execute(
                """
                INSERT INTO events (event_template_id, name, venue, event_date, start_time, status)
                VALUES (:event_template_id, :name, :venue, :event_date, :start_time, :status)
                RETURNING id
                """,
                fields,
            ).fetchone()[0]
            connection.commit()
            return event_id
        finally:
            connection.close()

    def create_participant(self, contact_number="+6591234567") -> int:
        response = self.client.post(
            "/api/v1/participants",
            json={"name": "Test Participant", "contact_number": contact_number},
        )
        return response.json()["id"]

    def test_list_events_defaults_to_all_open_first(self) -> None:
        self.insert_template_and_event(name="Future Event", event_date="2099-01-01")
        self.insert_template_and_event(name="Past Event", event_date="2000-01-01")

        response = self.client.get("/api/v1/events")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 2)
        self.assertEqual(body["limit"], 50)
        self.assertEqual(body["offset"], 0)

    def test_list_events_filters_by_date_range(self) -> None:
        self.insert_template_and_event(name="Future Event", event_date="2099-01-01")
        self.insert_template_and_event(name="Past Event", event_date="2000-01-01")

        response = self.client.get("/api/v1/events", params={"date_from": "2050-01-01"})

        self.assertEqual(response.status_code, 200)
        names = [item["name"] for item in response.json()["items"]]
        self.assertEqual(names, ["Future Event"])

    def test_get_event_not_found(self) -> None:
        response = self.client.get("/api/v1/events/999")
        self.assertEqual(response.status_code, 404)

    def test_get_event_includes_description(self) -> None:
        event_id = self.insert_template_and_event()
        from backend.database import connect

        connection = connect(self.client_context.app.state.database_path)
        connection.execute(
            "UPDATE events SET description = ? WHERE id = ?",
            ("Bring a water bottle.", event_id),
        )
        connection.commit()
        connection.close()

        response = self.client.get(f"/api/v1/events/{event_id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["description"], "Bring a water bottle.")

    def test_get_event_includes_time_when_set(self) -> None:
        event_id = self.insert_template_and_event(start_time="09:00")

        response = self.client.get(f"/api/v1/events/{event_id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["event_time"], "09:00")

    def test_list_events_includes_time(self) -> None:
        self.insert_template_and_event(name="Timed Event", start_time="14:30")

        response = self.client.get("/api/v1/events")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["event_time"], "14:30")

    def test_register_participant_for_open_event(self) -> None:
        event_id = self.insert_template_and_event(status="open")
        participant_id = self.create_participant()

        response = self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant_id, "rsvp_status": True},
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["rsvp_status"])

    def test_register_participant_blocked_when_event_closed(self) -> None:
        event_id = self.insert_template_and_event(status="closed")
        participant_id = self.create_participant()

        response = self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant_id, "rsvp_status": True},
        )

        self.assertEqual(response.status_code, 409)

    def test_register_missing_participant_returns_404(self) -> None:
        event_id = self.insert_template_and_event(status="open")

        response = self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": 999},
        )

        self.assertEqual(response.status_code, 404)

    def test_register_participant_is_idempotent(self) -> None:
        event_id = self.insert_template_and_event(status="open")
        participant_id = self.create_participant()

        self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant_id},
        )
        response = self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant_id},
        )

        self.assertEqual(response.status_code, 201)
        my_events = self.client.get(f"/api/v1/participants/{participant_id}/events").json()
        self.assertEqual(my_events["total"], 1)

    def test_patch_participation_cancels_rsvp(self) -> None:
        event_id = self.insert_template_and_event(status="open")
        participant_id = self.create_participant()
        self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant_id, "rsvp_status": True},
        )

        response = self.client.patch(
            f"/api/v1/events/{event_id}/participants/{participant_id}",
            json={"rsvp_status": False},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["rsvp_status"])
        # /participants/{id}/events returns full RSVP history (not just
        # active RSVPs), so the registration still shows up — just with
        # rsvp_status now false.
        my_events = self.client.get(f"/api/v1/participants/{participant_id}/events").json()
        self.assertEqual(my_events["total"], 1)
        self.assertFalse(my_events["items"][0]["rsvp_status"])

    def test_patch_participation_not_found(self) -> None:
        event_id = self.insert_template_and_event(status="open")
        participant_id = self.create_participant()

        response = self.client.patch(
            f"/api/v1/events/{event_id}/participants/{participant_id}",
            json={"rsvp_status": False},
        )

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
