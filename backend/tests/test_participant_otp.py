import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api.routes import public
from backend.database import connect
from backend.main import create_app


class FakeSentMessage:
    def __init__(self, to: str, body: str) -> None:
        self.to = to
        self.body = body
        self.wa_message_id = "fake-id"


class FakeWhatsAppClient:
    def __init__(self) -> None:
        self.texts: list[tuple[str, str]] = []
        self.templates: list[dict] = []

    def send_text(self, to: str, body: str):
        self.texts.append((to, body))
        return FakeSentMessage(to, body)

    def send_template(
        self, to, template_name, language_code, body_params=None, button_param=None, button_sub_type="url"
    ):
        self.templates.append(
            {
                "to": to,
                "template_name": template_name,
                "language_code": language_code,
                "body_params": body_params or [],
                "button_param": button_param,
                "button_sub_type": button_sub_type,
            }
        )
        return FakeSentMessage(to, f"[template:{template_name}]")


class ParticipantOtpTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

        self.fake_whatsapp = FakeWhatsAppClient()
        self.get_client_patcher = patch.object(public, "get_client", return_value=self.fake_whatsapp)
        self.get_client_patcher.start()

    def tearDown(self) -> None:
        self.get_client_patcher.stop()
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    # ----------------------------------------------------------------- #
    # Helpers
    # ----------------------------------------------------------------- #
    def signup(self, phone: str | None = "+6591230101", email: str | None = None, name: str = "Priya Kumar") -> dict:
        body: dict = {"name": name}
        if phone is not None:
            body["contact_number"] = phone
        if email is not None:
            body["email"] = email
        response = self.client.post("/api/v1/public/signup", json=body)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def latest_otp_code(self) -> str:
        template = self.fake_whatsapp.templates[-1]
        self.assertEqual(template["template_name"], "otp")
        self.assertEqual(template["language_code"], "en_US")
        self.assertEqual(template["button_sub_type"], "url")
        code = template["body_params"][0]
        self.assertEqual(template["button_param"], code)
        return code

    def force_otp_expired(self) -> None:
        connection = connect(self.database_path)
        connection.execute("UPDATE participants SET otp_expires_at = '2000-01-01T00:00:00+00:00'")
        connection.commit()
        connection.close()

    # ----------------------------------------------------------------- #
    # Tests
    # ----------------------------------------------------------------- #
    def test_signup_with_phone_sends_otp_and_returns_verify_token(self) -> None:
        result = self.signup()
        self.assertFalse(result["phone_verified"])
        self.assertIsNotNone(result["verify_token"])
        self.assertEqual(len(self.fake_whatsapp.templates), 1)
        code = self.latest_otp_code()
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())
        self.assertEqual(self.fake_whatsapp.texts, [])

    def test_signup_with_email_only_is_verified_with_no_token(self) -> None:
        result = self.signup(phone=None, email="priya@example.com")
        self.assertTrue(result["phone_verified"])
        self.assertIsNone(result["verify_token"])
        self.assertEqual(self.fake_whatsapp.templates, [])

    def test_verify_otp_with_correct_code_marks_verified_and_sends_welcome(self) -> None:
        result = self.signup()
        code = self.latest_otp_code()

        response = self.client.post(
            f"/api/v1/public/participants/{result['participant_id']}/verify-otp",
            json={"verify_token": result["verify_token"], "code": code},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["phone_verified"])

        self.assertEqual(len(self.fake_whatsapp.texts), 1)
        to, body = self.fake_whatsapp.texts[0]
        self.assertEqual(to, "+6591230101")
        self.assertIn("Welcome", body)

    def test_verify_otp_is_idempotent_once_already_verified(self) -> None:
        result = self.signup()
        code = self.latest_otp_code()
        participant_id = result["participant_id"]
        self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": result["verify_token"], "code": code},
        )

        second = self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": result["verify_token"], "code": "000000"},
        )
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()["phone_verified"])
        self.assertEqual(len(self.fake_whatsapp.texts), 1)

    def test_verify_otp_with_wrong_code_is_rejected(self) -> None:
        result = self.signup()
        response = self.client.post(
            f"/api/v1/public/participants/{result['participant_id']}/verify-otp",
            json={"verify_token": result["verify_token"], "code": "000000"},
        )
        self.assertEqual(response.status_code, 400)

    def test_verify_otp_with_wrong_token_is_rejected(self) -> None:
        result = self.signup()
        code = self.latest_otp_code()
        response = self.client.post(
            f"/api/v1/public/participants/{result['participant_id']}/verify-otp",
            json={"verify_token": "not-the-real-token", "code": code},
        )
        self.assertEqual(response.status_code, 401)

    def test_verify_otp_locks_out_after_too_many_wrong_attempts(self) -> None:
        result = self.signup()
        participant_id = result["participant_id"]
        token = result["verify_token"]

        for _ in range(public.OTP_MAX_ATTEMPTS):
            response = self.client.post(
                f"/api/v1/public/participants/{participant_id}/verify-otp",
                json={"verify_token": token, "code": "000000"},
            )
            self.assertEqual(response.status_code, 400)

        locked_out = self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": token, "code": "000000"},
        )
        self.assertEqual(locked_out.status_code, 429)

        code = self.latest_otp_code()
        still_locked = self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": token, "code": code},
        )
        self.assertEqual(still_locked.status_code, 429)

    def test_verify_otp_rejects_expired_code(self) -> None:
        result = self.signup()
        code = self.latest_otp_code()
        self.force_otp_expired()

        response = self.client.post(
            f"/api/v1/public/participants/{result['participant_id']}/verify-otp",
            json={"verify_token": result["verify_token"], "code": code},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("expired", response.json()["detail"].lower())

    def test_resend_otp_issues_a_fresh_code_and_rotates_the_token(self) -> None:
        result = self.signup()
        participant_id = result["participant_id"]
        original_token = result["verify_token"]
        original_code = self.latest_otp_code()

        resend_response = self.client.post(
            f"/api/v1/public/participants/{participant_id}/resend-otp",
            json={"verify_token": original_token},
        )
        self.assertEqual(resend_response.status_code, 200)
        new_token = resend_response.json()["verify_token"]
        self.assertIsNotNone(new_token)
        self.assertNotEqual(new_token, original_token)
        self.assertEqual(len(self.fake_whatsapp.templates), 2)
        new_code = self.latest_otp_code()

        # The old token no longer authorizes a verify call.
        stale_token_attempt = self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": original_token, "code": new_code},
        )
        self.assertEqual(stale_token_attempt.status_code, 401)

        # The old code no longer verifies even with the new token.
        stale_code_attempt = self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": new_token, "code": original_code},
        )
        self.assertEqual(stale_code_attempt.status_code, 400)

        success = self.client.post(
            f"/api/v1/public/participants/{participant_id}/verify-otp",
            json={"verify_token": new_token, "code": new_code},
        )
        self.assertEqual(success.status_code, 200)
        self.assertTrue(success.json()["phone_verified"])

    def test_returning_participant_with_matching_phone_is_not_asked_to_reverify(self) -> None:
        first = self.signup()
        code = self.latest_otp_code()
        self.client.post(
            f"/api/v1/public/participants/{first['participant_id']}/verify-otp",
            json={"verify_token": first["verify_token"], "code": code},
        )
        self.fake_whatsapp.templates.clear()

        second = self.signup()
        self.assertEqual(second["participant_id"], first["participant_id"])
        self.assertTrue(second["phone_verified"])
        self.assertIsNone(second["verify_token"])
        self.assertEqual(self.fake_whatsapp.templates, [])


if __name__ == "__main__":
    unittest.main()
