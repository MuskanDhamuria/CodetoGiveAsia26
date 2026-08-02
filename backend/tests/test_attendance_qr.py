import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.attendance_qr import PARTICIPANT_KIND, VOLUNTEER_KIND, generate_token, parse_token
from backend.database import connect
from backend.main import create_app


class AttendanceQrTokenTest(unittest.TestCase):
    def test_generated_token_round_trips(self) -> None:
        token = generate_token(PARTICIPANT_KIND, 7, 3)
        self.assertEqual(parse_token(token), (PARTICIPANT_KIND, 7, 3))

    def test_tampered_token_is_rejected(self) -> None:
        token = generate_token(VOLUNTEER_KIND, 7, 3)
        tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
        self.assertIsNone(parse_token(tampered))

    def test_token_with_swapped_event_id_is_rejected(self) -> None:
        # Copying the signature onto a different event id must not validate
        # — otherwise a QR code for one event could mark attendance at
        # another.
        token = generate_token(PARTICIPANT_KIND, 7, 3)
        _, person_id, _ = parse_token(token)
        forged = f"{PARTICIPANT_KIND}.{person_id}.999.{token.rsplit('.', 1)[-1]}"
        self.assertIsNone(parse_token(forged))

    def test_malformed_token_is_rejected(self) -> None:
        self.assertIsNone(parse_token("not-a-real-token"))
        self.assertIsNone(parse_token(""))


class AttendanceQrEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def create_event(self) -> dict:
        template = self.client.post(
            "/api/v1/event-templates",
            json={"name": "Wellness", "description": "A wellness event"},
        ).json()
        return self.client.post(
            "/api/v1/events",
            json={
                "event_template_id": template["id"],
                "name": "August Wellness Session",
                "venue": "Tampines Hub",
                "event_date": "2099-08-09",
            },
        ).json()

    def register_and_login_volunteer(self, event_id: int, phone: str = "+6580005002") -> tuple[str, int]:
        register = self.client.post(
            "/api/v1/volunteer-auth/register",
            json={"name": "Jamie", "contact_number": phone, "password": "Str0ngPass!"},
        )
        token = register.json()["access_token"]
        volunteer_id = register.json()["volunteer"]["volunteer_id"]
        headers = {"Authorization": f"Bearer {token}"}
        # Volunteer needs a signup row for the event to be eligible for a QR.
        connection = connect(self.database_path)
        connection.execute(
            "INSERT INTO volunteer_signups (event_id, volunteer_id, status) VALUES (?, ?, 'approved')",
            (event_id, volunteer_id),
        )
        connection.commit()
        connection.close()
        return token, volunteer_id

    def test_participant_qr_token_requires_registration(self) -> None:
        event = self.create_event()
        participant = self.client.post(
            "/api/v1/participants", json={"name": "Unregistered Person"}
        ).json()
        response = self.client.get(
            f"/api/v1/participants/{participant['id']}/events/{event['id']}/qr-token"
        )
        self.assertEqual(response.status_code, 404)

    def test_participant_qr_token_scan_marks_attendance(self) -> None:
        event = self.create_event()
        participant = self.client.post(
            "/api/v1/participants",
            json={"name": "Priya", "contact_number": "+6591230003"},
        ).json()
        self.client.post(
            f"/api/v1/events/{event['id']}/participants",
            json={"participant_id": participant["id"], "rsvp_status": True},
        )

        token_response = self.client.get(
            f"/api/v1/participants/{participant['id']}/events/{event['id']}/qr-token"
        )
        self.assertEqual(token_response.status_code, 200)
        token = token_response.json()["token"]

        scan_response = self.client.post(
            f"/api/v1/events/{event['id']}/attendance/scan", json={"token": token}
        )
        self.assertEqual(scan_response.status_code, 200)
        body = scan_response.json()
        self.assertEqual(body["name"], "Priya")
        self.assertEqual(body["role"], "participant")
        self.assertFalse(body["already_marked"])

        participants = self.client.get(
            f"/api/v1/events/{event['id']}/participants"
        ).json()["items"]
        self.assertTrue(participants[0]["attendance"])

        # Scanning again should succeed but report it was already marked.
        second_scan = self.client.post(
            f"/api/v1/events/{event['id']}/attendance/scan", json={"token": token}
        )
        self.assertEqual(second_scan.status_code, 200)
        self.assertTrue(second_scan.json()["already_marked"])

    def test_volunteer_qr_token_scan_marks_attendance(self) -> None:
        event = self.create_event()
        token, volunteer_id = self.register_and_login_volunteer(event["id"])

        qr_response = self.client.get(
            f"/api/v1/volunteer-auth/qr-token?event_id={event['id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(qr_response.status_code, 200)
        qr_token = qr_response.json()["token"]

        scan_response = self.client.post(
            f"/api/v1/events/{event['id']}/attendance/scan", json={"token": qr_token}
        )
        self.assertEqual(scan_response.status_code, 200)
        body = scan_response.json()
        self.assertEqual(body["name"], "Jamie")
        self.assertEqual(body["role"], "volunteer")

        signups = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups"
        ).json()["items"]
        matching = [row for row in signups if row["volunteer_id"] == volunteer_id]
        self.assertTrue(matching[0]["attendance"])

    def test_scan_rejects_token_for_a_different_event(self) -> None:
        event = self.create_event()
        other_event = self.create_event()
        participant = self.client.post(
            "/api/v1/participants",
            json={"name": "Priya", "contact_number": "+6591230004"},
        ).json()
        self.client.post(
            f"/api/v1/events/{event['id']}/participants",
            json={"participant_id": participant["id"], "rsvp_status": True},
        )
        token = self.client.get(
            f"/api/v1/participants/{participant['id']}/events/{event['id']}/qr-token"
        ).json()["token"]

        response = self.client.post(
            f"/api/v1/events/{other_event['id']}/attendance/scan", json={"token": token}
        )
        self.assertEqual(response.status_code, 400)

    def test_scan_rejects_garbage_token(self) -> None:
        event = self.create_event()
        response = self.client.post(
            f"/api/v1/events/{event['id']}/attendance/scan",
            json={"token": "garbage"},
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
