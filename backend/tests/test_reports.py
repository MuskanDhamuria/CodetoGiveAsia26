import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.database import connect
from backend.main import create_app


class ReportsEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()
        self.seed_closed_event()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def seed_closed_event(self) -> None:
        with connect(self.database_path) as connection:
            template_id = connection.execute(
                "INSERT INTO event_templates (name) VALUES (?) RETURNING id",
                ("Community",),
            ).fetchone()[0]
            event_id = connection.execute(
                """
                INSERT INTO events
                    (event_template_id, name, venue, event_date, status)
                VALUES (?, ?, ?, ?, 'closed')
                RETURNING id
                """,
                (template_id, "Health Fair", "Tampines Hub", "2026-07-18"),
            ).fetchone()[0]
            participant_id = connection.execute(
                "INSERT INTO participants (name) VALUES ('Jamie') RETURNING id"
            ).fetchone()[0]
            volunteer_id = connection.execute(
                "INSERT INTO volunteers (name) VALUES ('Alex') RETURNING id"
            ).fetchone()[0]
            connection.execute(
                """
                INSERT INTO participations
                    (event_id, participant_id, attendance)
                VALUES (?, ?, 1)
                """,
                (event_id, participant_id),
            )
            connection.execute(
                """
                INSERT INTO volunteer_signups
                    (event_id, volunteer_id, status, attendance)
                VALUES (?, ?, 'approved', 1)
                """,
                (event_id, volunteer_id),
            )
            connection.execute(
                "INSERT INTO event_partners (event_id, name) VALUES (?, ?)",
                (event_id, "CareWell Clinic"),
            )

    def test_completed_reports_uses_database_counts_and_partners(self) -> None:
        response = self.client.get("/api/v1/reports/completed")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()[0],
            {
                "id": 1,
                "name": "Health Fair",
                "date": "2026-07-18",
                "venue": "Tampines Hub",
                "report_status": "Incomplete",
                "attendees": 1,
                "volunteers": 1,
                "partners": ["CareWell Clinic"],
                "generated_caption": (
                    "Health Fair welcomed 1 attendees with the support of "
                    "1 volunteers and partners CareWell Clinic. Thank you to "
                    "everyone who helped create a meaningful day of service "
                    "and community connection. #PassionToServe #VolunteerSG"
                ),
            },
        )

    def test_mark_report_complete(self) -> None:
        response = self.client.put("/api/v1/reports/1/complete")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"event_id": 1, "report_status": "Complete"})
        reports = self.client.get("/api/v1/reports/completed").json()
        self.assertEqual(reports[0]["report_status"], "Complete")

    def test_save_photo_caption(self) -> None:
        response = self.client.post(
            "/api/v1/reports/1/photo-captions",
            json={
                "file_name": "photo.jpg",
                "caption": "Caption",
                "alt_text": "Alt text",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"id": 1, "event_id": 1})

    def test_generate_photo_caption(self) -> None:
        with patch(
            "backend.api.routes.reports.generate_caption_with_gemini",
            new_callable=AsyncMock,
            return_value=("AI caption", "AI alt text"),
        ):
            response = self.client.post(
                "/api/v1/reports/1/photo-caption",
                json={
                    "file_name": "photo.jpg",
                    "mime_type": "image/jpeg",
                    "image_data": "abc123",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "id": 1,
                "event_id": 1,
                "caption": "AI caption",
                "alt_text": "AI alt text",
            },
        )


if __name__ == "__main__":
    unittest.main()
