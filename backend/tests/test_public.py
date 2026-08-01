import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.database import connect
from backend.main import create_app


class PublicRsvpEndpointTest(unittest.TestCase):
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
                "event_time": "09:00",
                "status": "open",
            }
            fields.update(event_overrides)
            event_id = connection.execute(
                """
                INSERT INTO events (event_template_id, name, venue, event_date, event_time, status)
                VALUES (:event_template_id, :name, :venue, :event_date, :event_time, :status)
                RETURNING id
                """,
                fields,
            ).fetchone()[0]
            connection.commit()
            return event_id
        finally:
            connection.close()

    def test_rsvp_creates_a_new_participant_and_registers_them(self) -> None:
        event_id = self.insert_template_and_event()

        response = self.client.post(
            f"/api/v1/public/events/{event_id}/rsvp",
            json={"name": "Alice", "contact_number": "+6591234567"},
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["event_id"], event_id)
        self.assertTrue(body["rsvp_status"])
        self.assertEqual(body["participant_name"], "Alice")
        self.assertEqual(body["participant_contact_number"], "+6591234567")
        self.assertIsNone(body["participant_email"])

        my_events = self.client.get(f"/api/v1/participants/{body['participant_id']}/events").json()
        self.assertEqual(my_events["total"], 1)

    def test_rsvp_reuses_an_existing_participant_by_contact_number(self) -> None:
        first_event_id = self.insert_template_and_event(name="First event")
        second_event_id = self.insert_template_and_event(name="Second event")

        first = self.client.post(
            f"/api/v1/public/events/{first_event_id}/rsvp",
            json={"name": "Alice", "contact_number": "+6591234567"},
        ).json()
        second = self.client.post(
            f"/api/v1/public/events/{second_event_id}/rsvp",
            json={"name": "Alice again", "contact_number": "+6591234567"},
        ).json()

        self.assertEqual(first["participant_id"], second["participant_id"])

    def test_rsvp_returns_the_matched_participants_canonical_name_not_the_submitted_one(
        self,
    ) -> None:
        # TICKET-12: reusing an existing participant by contact number must
        # not let a differently-typed name on the second RSVP silently
        # relabel who the frontend thinks it's talking to.
        first_event_id = self.insert_template_and_event(name="First event")
        second_event_id = self.insert_template_and_event(name="Second event")

        self.client.post(
            f"/api/v1/public/events/{first_event_id}/rsvp",
            json={"name": "Alice", "contact_number": "+6591234567"},
        )
        second = self.client.post(
            f"/api/v1/public/events/{second_event_id}/rsvp",
            json={"name": "Someone Else Entirely", "contact_number": "+6591234567"},
        ).json()

        self.assertEqual(second["participant_name"], "Alice")

    def test_rsvp_returns_canonical_contact_number_even_when_typed_differently(self) -> None:
        first_event_id = self.insert_template_and_event(name="First event")
        second_event_id = self.insert_template_and_event(name="Second event")

        self.client.post(
            f"/api/v1/public/events/{first_event_id}/rsvp",
            json={"name": "Alice", "contact_number": "9123 4567"},
        )
        second = self.client.post(
            f"/api/v1/public/events/{second_event_id}/rsvp",
            json={"name": "Alice again", "contact_number": "+65 9123-4567"},
        ).json()

        self.assertEqual(second["participant_contact_number"], "+6591234567")

    def test_rsvp_matches_an_existing_participant_despite_different_formatting(self) -> None:
        first_event_id = self.insert_template_and_event(name="First event")
        second_event_id = self.insert_template_and_event(name="Second event")

        first = self.client.post(
            f"/api/v1/public/events/{first_event_id}/rsvp",
            json={"name": "Alice", "contact_number": "9123 4567"},
        ).json()
        second = self.client.post(
            f"/api/v1/public/events/{second_event_id}/rsvp",
            json={"name": "Alice again", "contact_number": "+65 9123-4567"},
        ).json()

        self.assertEqual(first["participant_id"], second["participant_id"])

    def test_rsvp_normalizes_and_stores_contact_number_as_e164(self) -> None:
        event_id = self.insert_template_and_event()

        result = self.client.post(
            f"/api/v1/public/events/{event_id}/rsvp",
            json={"name": "Alice", "contact_number": "9123 4567"},
        ).json()

        participant = self.client.get(
            f"/api/v1/participants/{result['participant_id']}"
        ).json()
        self.assertEqual(participant["contact_number"], "+6591234567")

    def test_rsvp_accepts_a_foreign_country_code(self) -> None:
        event_id = self.insert_template_and_event()

        result = self.client.post(
            f"/api/v1/public/events/{event_id}/rsvp",
            json={"name": "Bob", "contact_number": "+1 415 555 2671"},
        )

        self.assertEqual(result.status_code, 201)
        participant = self.client.get(
            f"/api/v1/participants/{result.json()['participant_id']}"
        ).json()
        self.assertEqual(participant["contact_number"], "+14155552671")

    def test_rsvp_rejects_an_invalid_contact_number(self) -> None:
        event_id = self.insert_template_and_event()

        response = self.client.post(
            f"/api/v1/public/events/{event_id}/rsvp",
            json={"name": "Alice", "contact_number": "not a phone number"},
        )

        self.assertEqual(response.status_code, 400)

    def test_rsvp_requires_contact_number_or_email(self) -> None:
        event_id = self.insert_template_and_event()

        response = self.client.post(
            f"/api/v1/public/events/{event_id}/rsvp", json={"name": "Alice"}
        )

        self.assertEqual(response.status_code, 400)

    def test_rsvp_blocked_when_event_closed(self) -> None:
        event_id = self.insert_template_and_event(status="closed")

        response = self.client.post(
            f"/api/v1/public/events/{event_id}/rsvp",
            json={"name": "Alice", "contact_number": "+6591234567"},
        )

        self.assertEqual(response.status_code, 409)

    def test_rsvp_event_not_found(self) -> None:
        response = self.client.post(
            "/api/v1/public/events/999/rsvp",
            json={"name": "Alice", "contact_number": "+6591234567"},
        )

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
