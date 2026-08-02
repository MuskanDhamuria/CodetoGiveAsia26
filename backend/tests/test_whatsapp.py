import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.bot import commands as bot_commands
from backend.integrations import whatsapp_client
from backend.main import create_app


class FakeSentMessage:
    def __init__(self, to: str, body: str) -> None:
        self.to = to
        self.body = body
        self.wa_message_id = "fake-id"


class FakeWhatsAppClient:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send_text(self, to: str, body: str):
        self.sent.append((to, body))
        return FakeSentMessage(to, body)


def inbound_payload(phone: str, text: str, name: str | None = None) -> dict:
    contact = {"wa_id": phone}
    if name:
        contact["profile"] = {"name": name}
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "entry-1",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "contacts": [contact],
                            "messages": [
                                {
                                    "from": phone,
                                    "id": f"wamid.{phone}.{hash(text)}",
                                    "type": "text",
                                    "text": {"body": text},
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


class WhatsAppBotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

        self.fake_whatsapp = FakeWhatsAppClient()
        self.get_client_patchers = [
            patch.object(whatsapp_client, "get_client", return_value=self.fake_whatsapp),
            patch.object(bot_commands, "get_client", return_value=self.fake_whatsapp),
        ]
        for patcher in self.get_client_patchers:
            patcher.start()

    def tearDown(self) -> None:
        for patcher in self.get_client_patchers:
            patcher.stop()
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    # ----------------------------------------------------------------- #
    # Fixtures
    # ----------------------------------------------------------------- #
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

    def add_role_to_event_template(self, event_template_id: int) -> int:
        """Seed a role directly; no CRUD route exists for roles yet."""

        connection = sqlite3.connect(self.database_path)
        connection.execute("PRAGMA foreign_keys = ON")
        role = connection.execute(
            "INSERT INTO roles (name, category, is_required) VALUES ('Greeter', 'execution', 0) RETURNING id"
        ).fetchone()
        role_id = role[0]
        connection.execute(
            "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
            (event_template_id, role_id),
        )
        connection.execute(
            """
            INSERT INTO event_roles (event_id, role_id)
            SELECT id, ? FROM events WHERE event_template_id = ?
            """,
            (role_id, event_template_id),
        )
        connection.commit()
        connection.close()
        return role_id

    def make_team_member_contact(self, phone: str) -> dict:
        team_member = self.client.post(
            "/api/v1/team-members",
            json={"name": "Ops Admin", "email": f"{phone}@example.org"},
        ).json()
        link_response = self.client.post(
            f"/api/v1/team-members/{team_member['id']}/whatsapp-link",
            json={"phone_number": phone},
        )
        self.assertEqual(link_response.status_code, 201)
        return team_member

    def register_volunteer(self, phone: str, name: str) -> dict:
        """Register a volunteer through the website flow, exactly like a real
        volunteer would — the bot no longer creates volunteer profiles from a
        chat reply, so any test that needs an existing volunteer must go
        through here first."""

        response = self.client.post(
            "/api/v1/volunteer-auth/register",
            json={"name": name, "contact_number": f"+{phone}", "password": "Str0ngPass!"},
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def send_message(self, phone: str, text: str, name: str | None = None):
        return self.client.post(
            "/api/v1/integrations/whatsapp/webhook",
            json=inbound_payload(phone, text, name),
        )

    # ----------------------------------------------------------------- #
    # Webhook plumbing
    # ----------------------------------------------------------------- #
    def test_webhook_verification_handshake(self) -> None:
        with patch.dict("os.environ", {"WHATSAPP_VERIFY_TOKEN": "secret-token"}):
            response = self.client.get(
                "/api/v1/integrations/whatsapp/webhook",
                params={
                    "hub.mode": "subscribe",
                    "hub.verify_token": "secret-token",
                    "hub.challenge": "1234",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "1234")

    def test_webhook_verification_rejects_wrong_token(self) -> None:
        with patch.dict("os.environ", {"WHATSAPP_VERIFY_TOKEN": "secret-token"}):
            response = self.client.get(
                "/api/v1/integrations/whatsapp/webhook",
                params={
                    "hub.mode": "subscribe",
                    "hub.verify_token": "wrong",
                    "hub.challenge": "1234",
                },
            )
        self.assertEqual(response.status_code, 403)

    def test_unknown_number_gets_greeting_and_is_logged(self) -> None:
        response = self.send_message("6580000001", "hi", name="Alex")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.fake_whatsapp.sent), 2)
        to, greeting_body = self.fake_whatsapp.sent[0]
        self.assertEqual(to, "6580000001")
        self.assertIn("Alex", greeting_body)

        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        contact = connection.execute(
            "SELECT * FROM whatsapp_contacts WHERE phone_number = ?", ("6580000001",)
        ).fetchone()
        self.assertIsNotNone(contact)
        self.assertEqual(contact["display_name"], "Alex")
        messages = connection.execute(
            "SELECT direction, body FROM whatsapp_messages WHERE contact_id = ? ORDER BY id",
            (contact["id"],),
        ).fetchall()
        connection.close()
        self.assertEqual(messages[0]["direction"], "inbound")
        self.assertEqual(messages[1]["direction"], "outbound")

    def test_greeting_with_punctuation_is_still_recognized(self) -> None:
        # Reproduces the "Chat on WhatsApp" pre-filled message, which starts
        # with "Hi! ..." — the "!" must not stop the bot from recognizing it
        # as a greeting.
        response = self.send_message(
            "6580000022", "Hi! I'd like to know about upcoming Passion To Serve events."
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("didn't understand", self.fake_whatsapp.sent[0][1])
        self.assertIn("Hi", self.fake_whatsapp.sent[0][1])

    def test_new_contact_is_asked_to_choose_participant_or_volunteer(self) -> None:
        phone = "6580000033"
        response = self.send_message(phone, "HI")
        self.assertEqual(response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn("PARTICIPANT", reply)
        self.assertIn("VOLUNTEER", reply)
        # The full command menu shouldn't show yet — just the role prompt.
        self.assertNotIn("SIGNUP <id>", reply)

    def test_participant_command_lists_events(self) -> None:
        event = self.create_event()
        phone = "6580000034"
        response = self.send_message(phone, "PARTICIPANT")
        self.assertEqual(response.status_code, 200)
        self.assertIn(event["name"], self.fake_whatsapp.sent[-1][1])

    def test_bare_volunteer_command_lists_events_with_a_hint(self) -> None:
        event = self.create_event()
        phone = "6580000035"
        response = self.send_message(phone, "VOLUNTEER")
        self.assertEqual(response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn(event["name"], reply)
        self.assertIn("VOLUNTEER SIGNUP <id>", reply)

    def test_role_prompt_stops_once_someone_has_signed_up(self) -> None:
        event = self.create_event()
        phone = "6580000036"
        self.send_message(phone, f"SIGNUP {event['id']}")
        self.send_message(phone, "Test Participant")

        response = self.send_message(phone, "HI")
        self.assertEqual(response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn("SIGNUP <id>", reply)
        self.assertNotIn("Reply PARTICIPANT or VOLUNTEER", reply)

    def test_hardcoded_admin_phone_has_bot_admin_commands_without_manual_linking(self) -> None:
        # backend.seed.ADMIN_WHATSAPP_LINKS is re-applied on every app
        # startup (see backend.main's lifespan), so these numbers should
        # already have admin access with no /whatsapp-link call needed —
        # this survives a database reset, unlike a manual link.
        help_response = self.send_message("6593430297", "HELP")
        self.assertEqual(help_response.status_code, 200)
        self.assertIn("BROADCAST", self.fake_whatsapp.sent[-1][1])

    def test_admins_are_not_shown_the_role_prompt(self) -> None:
        admin_phone = "6580000037"
        self.make_team_member_contact(admin_phone)
        response = self.send_message(admin_phone, "HI")
        self.assertEqual(response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn("BROADCAST", reply)
        self.assertNotIn("Reply PARTICIPANT or VOLUNTEER", reply)

    # ----------------------------------------------------------------- #
    # Participant flows
    # ----------------------------------------------------------------- #
    def test_participant_can_list_and_signup_for_event(self) -> None:
        event = self.create_event()
        phone = "6580000002"

        events_response = self.send_message(phone, "EVENTS")
        self.assertEqual(events_response.status_code, 200)

        prompt_response = self.send_message(phone, f"SIGNUP {event['id']}", name="Priya")
        self.assertEqual(prompt_response.status_code, 200)
        self.assertIn("What name", self.fake_whatsapp.sent[-1][1])

        signup_response = self.send_message(phone, "Priya Kumar")
        self.assertEqual(signup_response.status_code, 200)
        self.assertIn("signed up", self.fake_whatsapp.sent[-1][1])

        participants = self.client.get(
            f"/api/v1/events/{event['id']}/participants"
        ).json()["items"]
        self.assertEqual(len(participants), 1)
        self.assertEqual(participants[0]["contact_number"], phone)
        self.assertEqual(participants[0]["name"], "Priya Kumar")
        self.assertTrue(participants[0]["rsvp_status"])

    def test_signup_with_no_id_lists_events_instead_of_falling_back_to_unknown_command(self) -> None:
        phone = "6580000030"
        no_events_response = self.send_message(phone, "SIGNUP")
        self.assertEqual(no_events_response.status_code, 200)
        self.assertIn("no upcoming events", self.fake_whatsapp.sent[-1][1])

        event = self.create_event()
        with_event_response = self.send_message(phone, "SIGNUP")
        self.assertEqual(with_event_response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn(f"#{event['id']}", reply)
        self.assertIn("SIGNUP <id>", reply)

    def test_signup_name_prompt_can_be_cancelled(self) -> None:
        event = self.create_event()
        phone = "6580000028"
        self.send_message(phone, f"SIGNUP {event['id']}")
        response = self.send_message(phone, "STOP")
        self.assertEqual(response.status_code, 200)
        self.assertIn("cancelled", self.fake_whatsapp.sent[-1][1].lower())

        participants = self.client.get(
            f"/api/v1/events/{event['id']}/participants"
        ).json()["items"]
        self.assertEqual(len(participants), 0)

    def test_returning_participant_signs_up_without_being_asked_for_a_name_again(self) -> None:
        first_event = self.create_event()
        second_event = self.create_event()
        phone = "6580000029"
        self.send_message(phone, f"SIGNUP {first_event['id']}")
        self.send_message(phone, "Devi")

        response = self.send_message(phone, f"SIGNUP {second_event['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertIn("signed up", self.fake_whatsapp.sent[-1][1])

    def test_myevents_reports_registration(self) -> None:
        event = self.create_event()
        phone = "6580000003"
        self.send_message(phone, f"SIGNUP {event['id']}")
        self.send_message(phone, "Test Participant")
        response = self.send_message(phone, "MYEVENTS")
        self.assertEqual(response.status_code, 200)
        self.assertIn(event["name"], self.fake_whatsapp.sent[-1][1])

    def test_certificate_requires_recorded_attendance(self) -> None:
        event = self.create_event()
        phone = "6580000004"
        self.send_message(phone, f"SIGNUP {event['id']}")
        self.send_message(phone, "Test Participant")
        response = self.send_message(phone, f"CERT {event['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertIn("don't see attendance", self.fake_whatsapp.sent[-1][1])

    def test_cert_with_no_id_issues_certificate_when_only_one_event_attended(self) -> None:
        # A participant shouldn't need to already know an event id to get
        # their certificate: with attendance recorded at exactly one event,
        # plain "CERT" should issue it immediately.
        event = self.create_event()
        phone = "6580000023"
        self.send_message(phone, f"SIGNUP {event['id']}", name="Wei Ling")
        self.send_message(phone, "Wei Ling")
        admin_phone = "6580000024"
        self.make_team_member_contact(admin_phone)
        self.send_message(admin_phone, f"ATTEND {event['id']} {phone}")

        response = self.send_message(phone, "CERT")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Here's your certificate", self.fake_whatsapp.sent[-1][1])

    def test_cert_with_no_id_lists_events_when_multiple_attended(self) -> None:
        first_event = self.create_event()
        second_event = self.create_event()
        phone = "6580000025"
        admin_phone = "6580000026"
        self.make_team_member_contact(admin_phone)
        self.send_message(phone, f"SIGNUP {first_event['id']}", name="Ravi")
        self.send_message(phone, "Ravi")
        self.send_message(phone, f"SIGNUP {second_event['id']}")
        self.send_message(admin_phone, f"ATTEND {first_event['id']} {phone}")
        self.send_message(admin_phone, f"ATTEND {second_event['id']} {phone}")

        response = self.send_message(phone, "CERT")
        self.assertEqual(response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn(f"#{first_event['id']}", reply)
        self.assertIn(f"#{second_event['id']}", reply)
        self.assertIn("more than one event", reply)

        # Picking one by id still works exactly like before.
        follow_up = self.send_message(phone, f"CERT {first_event['id']}")
        self.assertEqual(follow_up.status_code, 200)
        self.assertIn("Here's your certificate", self.fake_whatsapp.sent[-1][1])

    def test_cert_with_no_attendance_and_no_id_gives_clear_message(self) -> None:
        event = self.create_event()
        phone = "6580000027"
        self.send_message(phone, f"SIGNUP {event['id']}")
        self.send_message(phone, "Test Participant")
        response = self.send_message(phone, "CERT")
        self.assertEqual(response.status_code, 200)
        self.assertIn("don't see attendance", self.fake_whatsapp.sent[-1][1])

    # ----------------------------------------------------------------- #
    # Volunteer flows
    # ----------------------------------------------------------------- #
    def test_volunteer_signup_and_confirm_after_admin_approval(self) -> None:
        event = self.create_event()
        role_id = self.add_role_to_event_template(event["event_template_id"])
        volunteer_phone = "6581230005"
        admin_phone = "6580000006"
        self.make_team_member_contact(admin_phone)
        self.register_volunteer(volunteer_phone, "Jamie Tan")

        signup_response = self.send_message(volunteer_phone, f"VOLUNTEER SIGNUP {event['id']}")
        self.assertEqual(signup_response.status_code, 200)
        self.assertIn("Thanks for volunteering", self.fake_whatsapp.sent[-1][1])
        signups = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups"
        ).json()["items"]
        self.assertEqual(len(signups), 1)
        signup_id = signups[0]["id"]
        self.assertEqual(signups[0]["status"], "requested")
        self.assertEqual(signups[0]["volunteer_name"], "Jamie Tan")

        approve_response = self.send_message(admin_phone, f"APPROVE {signup_id} {role_id}")
        self.assertEqual(approve_response.status_code, 200)

        signup_after_approval = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups/{signup_id}"
        ).json()
        self.assertEqual(signup_after_approval["status"], "approved")
        self.assertEqual(signup_after_approval["assigned_role_id"], role_id)

        tasks_response = self.send_message(volunteer_phone, "TASKS")
        self.assertEqual(tasks_response.status_code, 200)
        self.assertIn("CONFIRM", self.fake_whatsapp.sent[-1][1])

        confirm_response = self.send_message(volunteer_phone, f"CONFIRM {signup_id}")
        self.assertEqual(confirm_response.status_code, 200)
        self.assertIn("confirmed", self.fake_whatsapp.sent[-1][1].lower())

    def test_unregistered_volunteer_is_pointed_to_website_registration(self) -> None:
        # Becoming a volunteer only happens on the website now (OTP phone
        # verification lives there) — the bot must not create a volunteer
        # profile from a chat reply anymore.
        event = self.create_event()
        phone = "6580000031"
        response = self.send_message(phone, f"VOLUNTEER SIGNUP {event['id']}")
        self.assertEqual(response.status_code, 200)
        reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn("volunteer-register", reply)

        signups = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups"
        ).json()["items"]
        self.assertEqual(len(signups), 0)

    def test_returning_volunteer_signs_up_immediately(self) -> None:
        first_event = self.create_event()
        second_event = self.create_event()
        phone = "6581230032"
        self.register_volunteer(phone, "Noor")

        first_response = self.send_message(phone, f"VOLUNTEER SIGNUP {first_event['id']}")
        self.assertEqual(first_response.status_code, 200)
        self.assertIn("Thanks for volunteering", self.fake_whatsapp.sent[-1][1])

        second_response = self.send_message(phone, f"VOLUNTEER SIGNUP {second_event['id']}")
        self.assertEqual(second_response.status_code, 200)
        self.assertIn("Thanks for volunteering", self.fake_whatsapp.sent[-1][1])

    def test_pending_lists_roles_and_approve_accepts_hash_prefixed_ids(self) -> None:
        # Reproduces a real transcript: PENDING must show role numbers (there
        # was previously no way for an admin to know a valid role id), and
        # APPROVE must accept "#13" since that's exactly how the bot displays
        # ids back to the admin.
        event = self.create_event()
        role_id = self.add_role_to_event_template(event["event_template_id"])
        volunteer_phone = "6581230020"
        admin_phone = "6580000021"
        self.make_team_member_contact(admin_phone)
        self.register_volunteer(volunteer_phone, "Farah Hassan")
        self.send_message(volunteer_phone, f"VOLUNTEER SIGNUP {event['id']}")
        signup_id = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups"
        ).json()["items"][0]["id"]

        pending_response = self.send_message(admin_phone, f"PENDING {event['id']}")
        self.assertEqual(pending_response.status_code, 200)
        pending_reply = self.fake_whatsapp.sent[-1][1]
        self.assertIn("Farah Hassan", pending_reply)
        self.assertIn(f"Role #{role_id}: Greeter", pending_reply)
        self.assertIn(f"APPROVE {signup_id} {role_id}", pending_reply)

        approve_response = self.send_message(admin_phone, f"APPROVE #{signup_id} #{role_id}")
        self.assertEqual(approve_response.status_code, 200)
        signup_after_approval = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups/{signup_id}"
        ).json()
        self.assertEqual(signup_after_approval["status"], "approved")
        self.assertEqual(signup_after_approval["assigned_role_id"], role_id)

    # ----------------------------------------------------------------- #
    # Admin flows
    # ----------------------------------------------------------------- #
    def test_admin_broadcast_via_bot_and_via_http(self) -> None:
        event = self.create_event()
        participant_phone = "6580000007"
        admin_phone = "6580000008"
        self.make_team_member_contact(admin_phone)
        self.send_message(participant_phone, f"SIGNUP {event['id']}")
        self.send_message(participant_phone, "Test Participant")
        self.fake_whatsapp.sent.clear()

        bot_broadcast = self.send_message(admin_phone, f"BROADCAST {event['id']} Bring water bottles")
        self.assertEqual(bot_broadcast.status_code, 200)
        recipients = [to for to, _ in self.fake_whatsapp.sent]
        self.assertIn(participant_phone, recipients)

        http_response = self.client.post(
            f"/api/v1/events/{event['id']}/announcements",
            json={"title": "Update", "body": "Venue changed", "audience": "all"},
        )
        self.assertEqual(http_response.status_code, 201)
        announcement = http_response.json()
        self.assertGreaterEqual(announcement["delivered_count"], 1)

        listed = self.client.get(f"/api/v1/events/{event['id']}/announcements").json()
        self.assertEqual(len(listed), 2)

    def test_admin_attendance_and_certificate_generation(self) -> None:
        event = self.create_event()
        participant_phone = "6580000009"
        admin_phone = "6580000010"
        self.make_team_member_contact(admin_phone)
        self.send_message(participant_phone, f"SIGNUP {event['id']}", name="Sam")
        self.send_message(participant_phone, "Sam")

        attend_response = self.send_message(admin_phone, f"ATTEND {event['id']} {participant_phone}")
        self.assertEqual(attend_response.status_code, 200)
        self.assertIn("present", self.fake_whatsapp.sent[-1][1])

        cert_response = self.client.post(f"/api/v1/events/{event['id']}/certificates/generate")
        self.assertEqual(cert_response.status_code, 200)
        certificates = cert_response.json()
        self.assertEqual(len(certificates), 1)

        page = self.client.get(
            f"/api/v1/public/certificates/{certificates[0]['download_token']}"
        )
        self.assertEqual(page.status_code, 200)
        self.assertIn("Sam", page.text)

    def test_certificate_candidates_lists_registrants_regardless_of_attendance(self) -> None:
        event = self.create_event()
        attended_phone = "6580000041"
        no_show_phone = "6580000042"
        admin_phone = "6580000043"
        self.make_team_member_contact(admin_phone)
        self.send_message(attended_phone, f"SIGNUP {event['id']}", name="Attended Person")
        self.send_message(attended_phone, "Attended Person")
        self.send_message(no_show_phone, f"SIGNUP {event['id']}", name="No Show")
        self.send_message(no_show_phone, "No Show")
        self.send_message(admin_phone, f"ATTEND {event['id']} {attended_phone}")

        response = self.client.get(f"/api/v1/events/{event['id']}/certificate-candidates")
        self.assertEqual(response.status_code, 200)
        candidates = {row["name"]: row for row in response.json()}
        self.assertEqual(len(candidates), 2)
        self.assertTrue(candidates["Attended Person"]["attended"])
        self.assertFalse(candidates["No Show"]["attended"])
        self.assertFalse(candidates["No Show"]["already_issued"])

    def test_send_certificates_to_manually_selected_recipient_ignores_attendance(self) -> None:
        # An admin should be able to issue a certificate to someone who
        # wasn't marked present — e.g. attendance wasn't scanned in time.
        event = self.create_event()
        phone = "6580000044"
        self.send_message(phone, f"SIGNUP {event['id']}", name="Manual Pick")
        self.send_message(phone, "Manual Pick")
        candidates = self.client.get(
            f"/api/v1/events/{event['id']}/certificate-candidates"
        ).json()
        self.assertEqual(len(candidates), 1)
        self.assertFalse(candidates[0]["attended"])

        response = self.client.post(
            f"/api/v1/events/{event['id']}/certificates/send",
            json={"recipients": [{"type": "participant", "id": candidates[0]["id"]}]},
        )
        self.assertEqual(response.status_code, 200)
        certificates = response.json()
        self.assertEqual(len(certificates), 1)
        self.assertIsNotNone(certificates[0]["delivered_at"])
        self.assertIn("Here's your certificate", self.fake_whatsapp.sent[-1][1])

    def test_send_certificates_works_for_a_selected_volunteer(self) -> None:
        event = self.create_event()
        phone = "6591230045"
        self.register_volunteer(phone, "Selected Volunteer")
        self.send_message(phone, f"VOLUNTEER SIGNUP {event['id']}")
        candidates = self.client.get(
            f"/api/v1/events/{event['id']}/certificate-candidates"
        ).json()
        volunteer_candidate = next(row for row in candidates if row["type"] == "volunteer")

        response = self.client.post(
            f"/api/v1/events/{event['id']}/certificates/send",
            json={"recipients": [{"type": "volunteer", "id": volunteer_candidate["id"]}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertIn("Here's your certificate", self.fake_whatsapp.sent[-1][1])

    def test_send_certificates_rejects_a_recipient_not_registered_for_the_event(self) -> None:
        event = self.create_event()
        response = self.client.post(
            f"/api/v1/events/{event['id']}/certificates/send",
            json={"recipients": [{"type": "participant", "id": 99999}]},
        )
        self.assertEqual(response.status_code, 404)

    def test_send_certificates_requires_at_least_one_recipient(self) -> None:
        event = self.create_event()
        response = self.client.post(
            f"/api/v1/events/{event['id']}/certificates/send",
            json={"recipients": []},
        )
        self.assertEqual(response.status_code, 400)

    def test_website_volunteer_registration_auto_links_whatsapp(self) -> None:
        # Registering through the website's volunteer signup form should be
        # enough on its own — no separate WhatsApp SIGNUP step required for
        # the bot to already recognize them.
        register_response = self.client.post(
            "/api/v1/volunteer-auth/register",
            json={
                "name": "Wei Ling Tan",
                "contact_number": "+65 8123 0038",
                "password": "Str0ngPass!",
            },
        )
        self.assertEqual(register_response.status_code, 201)

        event = self.create_event()
        response = self.send_message("6581230038", f"VOLUNTEER SIGNUP {event['id']}")
        self.assertEqual(response.status_code, 200)
        # Already linked, so this should confirm immediately rather than
        # asking "What name should we register...".
        self.assertIn("Thanks for volunteering", self.fake_whatsapp.sent[-1][1])

    def test_reminder_endpoint_notifies_approved_volunteers(self) -> None:
        event = self.create_event()
        role_id = self.add_role_to_event_template(event["event_template_id"])
        volunteer_phone = "6581230011"
        admin_phone = "6580000012"
        self.make_team_member_contact(admin_phone)
        self.register_volunteer(volunteer_phone, "Test Volunteer")
        self.send_message(volunteer_phone, f"VOLUNTEER SIGNUP {event['id']}")
        signup_id = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups"
        ).json()["items"][0]["id"]
        self.client.post(
            f"/api/v1/events/{event['id']}/volunteer-signups/{signup_id}/approve",
            json={"assigned_role_id": role_id},
        )
        self.fake_whatsapp.sent.clear()

        response = self.client.post(f"/api/v1/events/{event['id']}/reminders", json={})
        self.assertEqual(response.status_code, 201)
        recipients = [to for to, _ in self.fake_whatsapp.sent]
        self.assertIn(volunteer_phone, recipients)

    def test_admin_link_with_plus_prefix_matches_inbound_message_without_it(self) -> None:
        # Meta's webhook reports the sender as digits only (no "+"), but an
        # organizer typing their number into the admin panel might include
        # one. Both must resolve to the same whatsapp_contacts row.
        team_member = self.client.post(
            "/api/v1/team-members",
            json={"name": "Aisha Rahman", "email": "aisha@example.org"},
        ).json()
        link_response = self.client.post(
            f"/api/v1/team-members/{team_member['id']}/whatsapp-link",
            json={"phone_number": "+6580000099"},
        )
        self.assertEqual(link_response.status_code, 201)

        help_response = self.send_message("6580000099", "HELP")
        self.assertEqual(help_response.status_code, 200)
        combined_reply = " ".join(body for _, body in self.fake_whatsapp.sent)
        self.assertIn("BROADCAST", combined_reply)

    def test_team_member_whatsapp_link_lifecycle(self) -> None:
        team_member = self.client.post(
            "/api/v1/team-members",
            json={"name": "Ju", "email": "ju@example.org"},
        ).json()
        other_member = self.client.post(
            "/api/v1/team-members",
            json={"name": "Other Admin", "email": "other@example.org"},
        ).json()
        phone = "6580000014"

        missing = self.client.get(f"/api/v1/team-members/{team_member['id']}/whatsapp-link")
        self.assertEqual(missing.status_code, 404)

        link_response = self.client.post(
            f"/api/v1/team-members/{team_member['id']}/whatsapp-link",
            json={"phone_number": phone},
        )
        self.assertEqual(link_response.status_code, 201)
        self.assertEqual(link_response.json()["team_member_id"], team_member["id"])

        # Bot admin commands now work for this phone number.
        help_response = self.send_message(phone, "HELP")
        self.assertEqual(help_response.status_code, 200)
        self.assertIn("BROADCAST", self.fake_whatsapp.sent[-1][1])

        # A different team member can't claim an already-linked number.
        conflict = self.client.post(
            f"/api/v1/team-members/{other_member['id']}/whatsapp-link",
            json={"phone_number": phone},
        )
        self.assertEqual(conflict.status_code, 409)

        fetched = self.client.get(f"/api/v1/team-members/{team_member['id']}/whatsapp-link")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["phone_number"], phone)

        unlink_response = self.client.delete(
            f"/api/v1/team-members/{team_member['id']}/whatsapp-link"
        )
        self.assertEqual(unlink_response.status_code, 204)

        after_unlink = self.client.get(f"/api/v1/team-members/{team_member['id']}/whatsapp-link")
        self.assertEqual(after_unlink.status_code, 404)

    def test_notification_subscription_opt_in_and_out(self) -> None:
        create_response = self.client.post(
            "/api/v1/public/notification-subscriptions",
            json={"phone_number": "6580000013", "display_name": "Kim"},
        )
        self.assertEqual(create_response.status_code, 201)
        subscription = create_response.json()
        self.assertTrue(subscription["notify_new_events"])

        delete_response = self.client.delete(
            f"/api/v1/public/notification-subscriptions/{subscription['id']}"
        )
        self.assertEqual(delete_response.status_code, 204)


if __name__ == "__main__":
    unittest.main()
