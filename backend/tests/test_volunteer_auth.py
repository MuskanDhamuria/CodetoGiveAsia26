import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api.routes import volunteer_auth
from backend.database import connect
from backend.main import create_app


class FakeSentMessage:
    def __init__(self, to: str, body: str) -> None:
        self.to = to
        self.body = body
        self.wa_message_id = "fake-id"


class FakeWhatsAppClient:
    """Captures both plain-text and template sends so tests can read back
    the OTP code that would have been delivered over WhatsApp."""

    def __init__(self) -> None:
        self.texts: list[tuple[str, str]] = []
        self.templates: list[dict] = []

    def send_text(self, to: str, body: str):
        self.texts.append((to, body))
        return FakeSentMessage(to, body)

    def send_template(self, to, template_name, language_code, body_params=None, button_param=None):
        self.templates.append(
            {
                "to": to,
                "template_name": template_name,
                "language_code": language_code,
                "body_params": body_params or [],
                "button_param": button_param,
            }
        )
        return FakeSentMessage(to, f"[template:{template_name}]")


class VolunteerOtpTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

        self.fake_whatsapp = FakeWhatsAppClient()
        self.get_client_patcher = patch.object(
            volunteer_auth, "get_client", return_value=self.fake_whatsapp
        )
        self.get_client_patcher.start()

    def tearDown(self) -> None:
        self.get_client_patcher.stop()
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    # ----------------------------------------------------------------- #
    # Helpers
    # ----------------------------------------------------------------- #
    def register(self, phone: str = "+6580009001", name: str = "Priya Kumar") -> dict:
        response = self.client.post(
            "/api/v1/volunteer-auth/register",
            json={"name": name, "contact_number": phone, "password": "Str0ngPass!"},
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def latest_otp_code(self) -> str:
        template = self.fake_whatsapp.templates[-1]
        self.assertEqual(template["template_name"], "otp")
        self.assertEqual(template["language_code"], "en_US")
        code = template["body_params"][0]
        self.assertEqual(template["button_param"], code)
        return code

    def force_otp_expired(self) -> None:
        connection = connect(self.database_path)
        connection.execute(
            "UPDATE volunteer_accounts SET otp_expires_at = '2000-01-01T00:00:00+00:00'"
        )
        connection.commit()
        connection.close()

    # ----------------------------------------------------------------- #
    # Tests
    # ----------------------------------------------------------------- #
    def test_register_sends_otp_template_and_starts_unverified(self) -> None:
        result = self.register()
        self.assertFalse(result["volunteer"]["phone_verified"])
        self.assertEqual(len(self.fake_whatsapp.templates), 1)
        code = self.latest_otp_code()
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())
        # No welcome text yet — that only goes out after verification.
        self.assertEqual(self.fake_whatsapp.texts, [])

    def test_verify_otp_with_correct_code_marks_verified_and_sends_welcome(self) -> None:
        result = self.register()
        token = result["access_token"]
        code = self.latest_otp_code()

        response = self.client.post(
            "/api/v1/volunteer-auth/verify-otp",
            json={"code": code},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["phone_verified"])

        me = self.client.get(
            "/api/v1/volunteer-auth/me", headers={"Authorization": f"Bearer {token}"}
        ).json()
        self.assertTrue(me["phone_verified"])

        self.assertEqual(len(self.fake_whatsapp.texts), 1)
        to, body = self.fake_whatsapp.texts[0]
        self.assertEqual(to, "+6580009001")
        self.assertIn("Welcome", body)

    def test_verify_otp_is_idempotent_once_already_verified(self) -> None:
        result = self.register()
        token = result["access_token"]
        code = self.latest_otp_code()
        headers = {"Authorization": f"Bearer {token}"}
        self.client.post("/api/v1/volunteer-auth/verify-otp", json={"code": code}, headers=headers)

        second = self.client.post(
            "/api/v1/volunteer-auth/verify-otp", json={"code": "000000"}, headers=headers
        )
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()["phone_verified"])
        # Still only the one welcome message from the first successful verify.
        self.assertEqual(len(self.fake_whatsapp.texts), 1)

    def test_verify_otp_with_wrong_code_is_rejected_and_does_not_verify(self) -> None:
        result = self.register()
        token = result["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        response = self.client.post(
            "/api/v1/volunteer-auth/verify-otp", json={"code": "000000"}, headers=headers
        )
        self.assertEqual(response.status_code, 400)

        me = self.client.get("/api/v1/volunteer-auth/me", headers=headers).json()
        self.assertFalse(me["phone_verified"])

    def test_verify_otp_locks_out_after_too_many_wrong_attempts(self) -> None:
        result = self.register()
        token = result["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        for _ in range(volunteer_auth.OTP_MAX_ATTEMPTS):
            response = self.client.post(
                "/api/v1/volunteer-auth/verify-otp", json={"code": "000000"}, headers=headers
            )
            self.assertEqual(response.status_code, 400)

        locked_out = self.client.post(
            "/api/v1/volunteer-auth/verify-otp", json={"code": "000000"}, headers=headers
        )
        self.assertEqual(locked_out.status_code, 429)

        # Even the real code is rejected until they ask for a fresh one.
        code = self.latest_otp_code()
        still_locked = self.client.post(
            "/api/v1/volunteer-auth/verify-otp", json={"code": code}, headers=headers
        )
        self.assertEqual(still_locked.status_code, 429)

    def test_verify_otp_rejects_expired_code(self) -> None:
        result = self.register()
        token = result["access_token"]
        code = self.latest_otp_code()
        self.force_otp_expired()

        response = self.client.post(
            "/api/v1/volunteer-auth/verify-otp",
            json={"code": code},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("expired", response.json()["detail"].lower())

    def test_resend_otp_issues_a_fresh_code_that_verifies(self) -> None:
        result = self.register()
        token = result["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        original_code = self.latest_otp_code()

        resend_response = self.client.post("/api/v1/volunteer-auth/resend-otp", headers=headers)
        self.assertEqual(resend_response.status_code, 200)
        self.assertFalse(resend_response.json()["phone_verified"])
        self.assertEqual(len(self.fake_whatsapp.templates), 2)
        new_code = self.latest_otp_code()

        # The old code no longer verifies once a new one has been issued.
        stale_attempt = self.client.post(
            "/api/v1/volunteer-auth/verify-otp", json={"code": original_code}, headers=headers
        )
        self.assertEqual(stale_attempt.status_code, 400)

        success = self.client.post(
            "/api/v1/volunteer-auth/verify-otp", json={"code": new_code}, headers=headers
        )
        self.assertEqual(success.status_code, 200)
        self.assertTrue(success.json()["phone_verified"])

    def test_verify_otp_requires_authentication(self) -> None:
        self.register()
        response = self.client.post("/api/v1/volunteer-auth/verify-otp", json={"code": "123456"})
        self.assertEqual(response.status_code, 401)

    def test_login_reports_current_verification_status(self) -> None:
        result = self.register()
        code = self.latest_otp_code()
        self.client.post(
            "/api/v1/volunteer-auth/verify-otp",
            json={"code": code},
            headers={"Authorization": f"Bearer {result['access_token']}"},
        )

        login_response = self.client.post(
            "/api/v1/volunteer-auth/login",
            json={"contact_number": "+6580009001", "password": "Str0ngPass!"},
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.json()["volunteer"]["phone_verified"])


if __name__ == "__main__":
    unittest.main()
