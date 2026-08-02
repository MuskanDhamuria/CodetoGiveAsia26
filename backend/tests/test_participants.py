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

    def test_create_participant_normalizes_contact_number(self) -> None:
        response = self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "9123 4567"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["contact_number"], "+6591234567")

    def test_create_participant_rejects_duplicate_contact_number_in_different_formats(
        self,
    ) -> None:
        self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "9123 4567"},
        )

        response = self.client.post(
            "/api/v1/participants",
            json={"name": "Someone else", "contact_number": "+65 9123-4567"},
        )

        self.assertEqual(response.status_code, 409)

    def test_create_participant_rejects_invalid_contact_number(self) -> None:
        response = self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "not a phone number"},
        )

        self.assertEqual(response.status_code, 400)

    def test_get_participant_not_found(self) -> None:
        response = self.client.get("/api/v1/participants/999")
        self.assertEqual(response.status_code, 404)

    def test_lookup_participant_by_contact_number(self) -> None:
        created = self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "+6591234567"},
        ).json()

        response = self.client.get(
            "/api/v1/participants/lookup", params={"contact_number": "+6591234567"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], created["id"])

    def test_lookup_participant_matches_despite_different_formatting(self) -> None:
        created = self.client.post(
            "/api/v1/participants",
            json={"name": "Alice", "contact_number": "9123 4567"},
        ).json()

        response = self.client.get(
            "/api/v1/participants/lookup", params={"contact_number": "+65 9123-4567"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], created["id"])

    def test_lookup_participant_not_found_is_honest_404(self) -> None:
        response = self.client.get(
            "/api/v1/participants/lookup", params={"contact_number": "+6591234567"}
        )

        self.assertEqual(response.status_code, 404)

    def test_lookup_participant_rejects_invalid_contact_number(self) -> None:
        response = self.client.get(
            "/api/v1/participants/lookup", params={"contact_number": "not a phone number"}
        )

        self.assertEqual(response.status_code, 400)

    def test_lookup_participant_requires_contact_number_query_param(self) -> None:
        response = self.client.get("/api/v1/participants/lookup")

        self.assertEqual(response.status_code, 422)

    def test_lookup_route_takes_priority_over_numeric_participant_id_route(self) -> None:
        # Regression guard: "/participants/lookup" must not be swallowed by
        # "/participants/{participant_id}" (which would 422 trying to parse
        # "lookup" as an int) — route registration order matters here.
        response = self.client.get(
            "/api/v1/participants/lookup", params={"contact_number": "+6591234567"}
        )

        self.assertNotEqual(response.status_code, 422)

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
            json={"participant_id": participant["id"], "rsvp_status": True},
        )

        response = self.client.get(f"/api/v1/participants/{participant['id']}/events")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["name"], "Signed up for this one")
        self.assertTrue(body["items"][0]["rsvp_status"])

    def test_participant_events_includes_event_time(self) -> None:
        event_id = self.insert_template_and_event(start_time="09:00")
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Bob", "contact_number": "+6598765432"}
        ).json()
        self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant["id"]},
        )

        response = self.client.get(f"/api/v1/participants/{participant['id']}/events")

        self.assertEqual(response.json()["items"][0]["event_time"], "09:00")

    def test_participant_events_flags_a_since_cancelled_event(self) -> None:
        event_id = self.insert_template_and_event(name="Beach Cleanup")
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Bob", "contact_number": "+6598765432"}
        ).json()
        self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant["id"]},
        )

        cancelled = self.client.post(f"/api/v1/events/{event_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)

        response = self.client.get(f"/api/v1/participants/{participant['id']}/events")

        self.assertEqual(response.status_code, 200)
        item = response.json()["items"][0]
        self.assertTrue(item["is_cancelled"])
        self.assertEqual(item["status"], "closed")
        self.assertNotIn("cancelled_at", item)

    def test_update_participant_edits_profile_fields(self) -> None:
        # TICKET-46: the participant portal's self-service profile edit
        # form goes through this existing PATCH endpoint.
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Alice", "contact_number": "+6591234567"}
        ).json()

        response = self.client.patch(
            f"/api/v1/participants/{participant['id']}",
            json={"name": "Alice Tan", "email": "alice.tan@example.com"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["name"], "Alice Tan")
        self.assertEqual(body["email"], "alice.tan@example.com")
        self.assertEqual(body["contact_number"], "+6591234567")

    def test_update_participant_not_found(self) -> None:
        response = self.client.patch("/api/v1/participants/999", json={"name": "Ghost"})

        self.assertEqual(response.status_code, 404)

    def test_get_participant_certificate_not_yet_issued(self) -> None:
        event_id = self.insert_template_and_event()
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Bob", "contact_number": "+6598765432"}
        ).json()
        self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant["id"]},
        )

        response = self.client.get(
            f"/api/v1/participants/{participant['id']}/events/{event_id}/certificate"
        )

        self.assertEqual(response.status_code, 404)

    def test_get_participant_certificate_returns_link_once_issued(self) -> None:
        event_id = self.insert_template_and_event()
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Bob", "contact_number": "+6598765432"}
        ).json()
        self.client.post(
            f"/api/v1/events/{event_id}/participants",
            json={"participant_id": participant["id"]},
        )
        self.client.patch(
            f"/api/v1/events/{event_id}/participants/{participant['id']}",
            json={"attendance": True},
        )
        generated = self.client.post(f"/api/v1/events/{event_id}/certificates/generate")
        self.assertEqual(generated.status_code, 200)

        response = self.client.get(
            f"/api/v1/participants/{participant['id']}/events/{event_id}/certificate"
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("link", response.json())
        self.assertIn(f"/public/certificates/", response.json()["link"])

    def test_get_participant_certificate_requires_existing_participant(self) -> None:
        event_id = self.insert_template_and_event()

        response = self.client.get(f"/api/v1/participants/999/events/{event_id}/certificate")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
