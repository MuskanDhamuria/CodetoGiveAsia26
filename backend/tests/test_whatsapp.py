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

    # ----------------------------------------------------------------- #
    # Participant flows
    # ----------------------------------------------------------------- #
    def test_participant_can_list_and_signup_for_event(self) -> None:
        event = self.create_event()
        phone = "6580000002"

        events_response = self.send_message(phone, "EVENTS")
        self.assertEqual(events_response.status_code, 200)

        signup_response = self.send_message(phone, f"SIGNUP {event['id']}", name="Priya")
        self.assertEqual(signup_response.status_code, 200)
        self.assertIn("signed up", self.fake_whatsapp.sent[-1][1])

        participants = self.client.get(
            f"/api/v1/events/{event['id']}/participants"
        ).json()["items"]
        self.assertEqual(len(participants), 1)
        self.assertEqual(participants[0]["contact_number"], phone)
        self.assertTrue(participants[0]["rsvp_status"])

    def test_myevents_reports_registration(self) -> None:
        event = self.create_event()
        phone = "6580000003"
        self.send_message(phone, f"SIGNUP {event['id']}")
        response = self.send_message(phone, "MYEVENTS")
        self.assertEqual(response.status_code, 200)
        self.assertIn(event["name"], self.fake_whatsapp.sent[-1][1])

    def test_certificate_requires_recorded_attendance(self) -> None:
        event = self.create_event()
        phone = "6580000004"
        self.send_message(phone, f"SIGNUP {event['id']}")
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
        response = self.send_message(phone, "CERT")
        self.assertEqual(response.status_code, 200)
        self.assertIn("don't see attendance", self.fake_whatsapp.sent[-1][1])

    # ----------------------------------------------------------------- #
    # Volunteer flows
    # ----------------------------------------------------------------- #
    def test_volunteer_signup_and_confirm_after_admin_approval(self) -> None:
        event = self.create_event()
        role_id = self.add_role_to_event_template(event["event_template_id"])
        volunteer_phone = "6580000005"
        admin_phone = "6580000006"
        self.make_team_member_contact(admin_phone)

        self.send_message(volunteer_phone, f"VOLUNTEER SIGNUP {event['id']}", name="Jamie")
        signups = self.client.get(
            f"/api/v1/events/{event['id']}/volunteer-signups"
        ).json()["items"]
        self.assertEqual(len(signups), 1)
        signup_id = signups[0]["id"]
        self.assertEqual(signups[0]["status"], "requested")

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

    def test_pending_lists_roles_and_approve_accepts_hash_prefixed_ids(self) -> None:
        # Reproduces a real transcript: PENDING must show role numbers (there
        # was previously no way for an admin to know a valid role id), and
        # APPROVE must accept "#13" since that's exactly how the bot displays
        # ids back to the admin.
        event = self.create_event()
        role_id = self.add_role_to_event_template(event["event_template_id"])
        volunteer_phone = "6580000020"
        admin_phone = "6580000021"
        self.make_team_member_contact(admin_phone)
        self.send_message(volunteer_phone, f"VOLUNTEER SIGNUP {event['id']}", name="Farah Hassan")
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

    def test_reminder_endpoint_notifies_approved_volunteers(self) -> None:
        event = self.create_event()
        role_id = self.add_role_to_event_template(event["event_template_id"])
        volunteer_phone = "6580000011"
        admin_phone = "6580000012"
        self.make_team_member_contact(admin_phone)
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
