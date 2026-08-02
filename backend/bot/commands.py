"""WhatsApp bot conversation logic.

``dispatch`` is the single entry point: given a database connection, the
``whatsapp_contacts`` row for the sender, and the inbound message text, it
performs whatever database work the command implies and returns the list of
reply messages to send back. Keeping all database access inside this module
(rather than the route handler) makes the conversation logic directly
testable without going through the HTTP webhook or a real WhatsApp client.

Commands are deliberately simple, keyword-first text commands rather than
free-form natural language, matching what a WhatsApp/Telegram bot MVP can
reliably parse without an LLM in the loop.
"""

from __future__ import annotations

import logging
import os
import secrets
import sqlite3
import string

from backend.integrations.whatsapp_client import get_client

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Contact helpers
# --------------------------------------------------------------------------- #
def normalize_phone_number(value: str) -> str:
    """Reduce a phone number to digits only, matching Meta's webhook format.

    Meta's Cloud API reports the sender of an inbound message as digits only
    (for example ``6591234567``, never ``+6591234567``). Anything typed by an
    organizer — with a leading ``+``, spaces, or dashes — needs to normalize
    to the same key, or a WhatsApp number linked via the admin panel will
    silently never match the contact created from real inbound messages.
    """

    return "".join(character for character in value if character.isdigit())


def get_or_create_contact(db: sqlite3.Connection, phone_number: str) -> sqlite3.Row:
    normalized = normalize_phone_number(phone_number)
    row = db.execute(
        "SELECT * FROM whatsapp_contacts WHERE phone_number = ?", (normalized,)
    ).fetchone()
    if row is not None:
        return row
    row = db.execute(
        """
        INSERT INTO whatsapp_contacts (phone_number)
        VALUES (?) RETURNING *
        """,
        (normalized,),
    ).fetchone()
    db.commit()
    return row


def _touch_contact(db: sqlite3.Connection, contact_id: int, **fields: object) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{field} = ?" for field in fields)
    db.execute(
        f"UPDATE whatsapp_contacts SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [*fields.values(), contact_id],
    )
    db.commit()


def certificate_link(token: str) -> str:
    base = os.environ.get("PASSION_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/public/certificates/{token}"


# --------------------------------------------------------------------------- #
# Menus
# --------------------------------------------------------------------------- #
GENERAL_MENU = (
    "Here's what I can do:\n"
    "EVENTS - list upcoming events\n"
    "EVENT <id> - event details\n"
    "SIGNUP <id> - RSVP for an event\n"
    "MYEVENTS - your registrations\n"
    "CERT - get your certificate (asks which event if you attended more than one)\n"
    "VOLUNTEER SIGNUP <id> - apply to volunteer\n"
    "STOP / START - turn new-event alerts off/on"
)

VOLUNTEER_MENU_EXTRA = (
    "TASKS - your volunteer assignments\n"
    "CONFIRM <signup id> - confirm an assignment"
)

ADMIN_MENU_EXTRA = (
    "BROADCAST <event id|ALL> <message> - send an announcement\n"
    "REMIND <event id> - send a shift reminder to approved volunteers\n"
    "PENDING <event id> - list volunteer requests awaiting review\n"
    "APPROVE <signup id> <role id> - approve and assign a role\n"
    "REJECT <signup id> - reject a volunteer request\n"
    "ATTEND <event id> <phone> - mark participant attendance\n"
    "MARK <event id> <phone> - mark volunteer attendance"
)


def menu_for(contact: sqlite3.Row) -> str:
    parts = [GENERAL_MENU]
    if contact["volunteer_id"] is not None:
        parts.append(VOLUNTEER_MENU_EXTRA)
    if contact["team_member_id"] is not None:
        parts.append(ADMIN_MENU_EXTRA)
    return "\n\n".join(parts)


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #
def dispatch(db: sqlite3.Connection, contact: sqlite3.Row, text: str) -> list[str]:
    stripped = text.strip()

    pending_kind, pending_event_id = _pending_state(contact)
    if pending_kind == "participant":
        return complete_signup_with_name(db, contact, pending_event_id, stripped)

    if not stripped:
        return [greeting(contact)]

    tokens = stripped.split()
    # People naturally type "Hi!", "Hello?", "help." etc. — strip surrounding
    # punctuation from the command word itself (never from the arguments
    # that follow, so a BROADCAST message or someone's name is untouched).
    command = tokens[0].strip(string.punctuation).upper()
    rest = tokens[1:]

    if command in ("HI", "HELLO", "HELP", "MENU", "START"):
        if command == "START":
            _touch_contact(db, contact["id"], notify_new_events=1)
            return ["You're subscribed to new-event alerts again.", menu_for(contact)]
        if _needs_role_prompt(contact):
            return [greeting(contact), ROLE_PROMPT]
        return [greeting(contact), menu_for(contact)]
    if command == "PARTICIPANT":
        return [list_events(db)]
    if command == "VOLUNTEER" and not (rest and rest[0].upper() == "SIGNUP"):
        return [
            list_events(db) + "\nTo volunteer instead, reply VOLUNTEER SIGNUP <id>."
        ]
    if command == "STOP":
        _touch_contact(db, contact["id"], notify_new_events=0)
        return ["You won't receive new-event alerts anymore. Reply START to resume."]
    if command == "EVENTS":
        return [list_events(db)]
    if command == "EVENT" and rest:
        return [event_details(db, contact, rest[0])]
    if command == "SIGNUP" and rest:
        return signup_for_event(db, contact, rest[0])
    if command == "SIGNUP":
        # No id given — show what's on (or that nothing is), same as EVENTS,
        # instead of falling through to the generic "didn't understand" reply.
        return [list_events(db)]
    if command == "MYEVENTS":
        return [my_events(db, contact)]
    if command == "CERT":
        return [request_certificate(db, contact, rest[0] if rest else None)]
    if command == "VOLUNTEER" and rest and rest[0].upper() == "SIGNUP" and len(rest) > 1:
        return volunteer_signup(db, contact, rest[1])
    if command == "TASKS":
        return [volunteer_tasks(db, contact)]
    if command == "CONFIRM" and rest:
        return [confirm_assignment(db, contact, rest[0])]

    if contact["team_member_id"] is not None:
        if command == "BROADCAST" and len(rest) >= 2:
            return [admin_broadcast(db, contact, rest[0], " ".join(rest[1:]))]
        if command == "REMIND" and rest:
            return [admin_remind(db, contact, rest[0])]
        if command == "PENDING" and rest:
            return [admin_pending(db, rest[0])]
        if command == "APPROVE" and len(rest) >= 2:
            return [admin_approve(db, rest[0], rest[1])]
        if command == "REJECT" and rest:
            return [admin_reject(db, rest[0])]
        if command == "ATTEND" and len(rest) >= 2:
            return [admin_attendance(db, rest[0], rest[1], volunteer=False)]
        if command == "MARK" and len(rest) >= 2:
            return [admin_attendance(db, rest[0], rest[1], volunteer=True)]

    return [
        "Sorry, I didn't understand that. Reply HELP to see what I can do."
    ]


def greeting(contact: sqlite3.Row) -> str:
    name = contact["display_name"] or "there"
    return f"Hi {name}! I'm the Passion to Serve bot."


ROLE_PROMPT = (
    "Are you here to attend an event as a participant, or to help out as a "
    "volunteer? Reply PARTICIPANT or VOLUNTEER (or EVENTS to just browse)."
)


def _needs_role_prompt(contact: sqlite3.Row) -> bool:
    """True until this contact has signed up as either a participant or a
    volunteer. Admins (linked via the website, never self-service) aren't
    nudged — they already have a defined role."""

    return (
        contact["participant_id"] is None
        and contact["volunteer_id"] is None
        and contact["team_member_id"] is None
    )


# --------------------------------------------------------------------------- #
# Participant commands
# --------------------------------------------------------------------------- #
def list_events(db: sqlite3.Connection) -> str:
    rows = db.execute(
        """
        SELECT id, name, venue, event_date FROM events
        WHERE status = 'open' AND event_date >= date('now')
        ORDER BY event_date LIMIT 10
        """
    ).fetchall()
    if not rows:
        return "There are no upcoming events right now."
    lines = ["Upcoming events:"]
    for row in rows:
        lines.append(f"#{row['id']} {row['name']} - {row['event_date']} @ {row['venue']}")
    lines.append("Reply EVENT <id> for details or SIGNUP <id> to RSVP.")
    return "\n".join(lines)


def _parse_int(value: str) -> int | None:
    # The bot always displays IDs with a leading "#" (e.g. "#12 Farah
    # Hassan"), so people naturally copy that back when replying — accept
    # "#12" as well as "12" everywhere an ID is expected.
    cleaned = value.strip().lstrip("#")
    try:
        return int(cleaned)
    except ValueError:
        return None


def event_details(db: sqlite3.Connection, contact: sqlite3.Row, raw_id: str) -> str:
    event_id = _parse_int(raw_id)
    if event_id is None:
        return "Reply EVENT <event id>, for example EVENT 12."
    event = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return f"I couldn't find event #{event_id}."
    lines = [
        f"{event['name']} (#{event['id']})",
        f"Date: {event['event_date']}",
        f"Venue: {event['venue']}",
    ]
    if event["description"]:
        lines.append(event["description"])
    if contact["participant_id"] is not None:
        participation = db.execute(
            "SELECT rsvp_status, attendance FROM participations WHERE event_id = ? AND participant_id = ?",
            (event_id, contact["participant_id"]),
        ).fetchone()
        if participation is not None:
            lines.append(
                "You're RSVP'd yes." if participation["rsvp_status"] else "You're on the list but not RSVP'd yes."
            )
    lines.append("Reply SIGNUP {} to RSVP.".format(event_id))
    return "\n".join(lines)


def _find_or_create_participant(
    db: sqlite3.Connection, contact: sqlite3.Row, name_hint: str | None
) -> int:
    if contact["participant_id"] is not None:
        return contact["participant_id"]
    existing = db.execute(
        "SELECT id FROM participants WHERE contact_number = ?", (contact["phone_number"],)
    ).fetchone()
    if existing is not None:
        participant_id = existing["id"]
    else:
        name = name_hint or contact["display_name"] or contact["phone_number"]
        participant_id = db.execute(
            "INSERT INTO participants (name, contact_number) VALUES (?, ?) RETURNING id",
            (name, contact["phone_number"]),
        ).fetchone()["id"]
        db.commit()
    _touch_contact(db, contact["id"], participant_id=participant_id)
    return participant_id


_SIGNUP_NAME_STATE_PREFIX = "SIGNUP_NAME:"


def _pending_state(contact: sqlite3.Row) -> tuple[str | None, int | None]:
    """("participant" | None, event id) if awaiting a name reply.

    Volunteer signup no longer has a "waiting for a name" state — becoming a
    volunteer only happens on the website now (see volunteer_signup()).
    """

    state = contact["conversation_state"]
    if not state:
        return None, None
    if state.startswith(_SIGNUP_NAME_STATE_PREFIX):
        return "participant", _parse_int(state[len(_SIGNUP_NAME_STATE_PREFIX) :])
    return None, None


def _register_participation(db: sqlite3.Connection, event_id: int, participant_id: int) -> None:
    existing = db.execute(
        "SELECT rsvp_status FROM participations WHERE event_id = ? AND participant_id = ?",
        (event_id, participant_id),
    ).fetchone()
    if existing is not None:
        db.execute(
            "UPDATE participations SET rsvp_status = 1 WHERE event_id = ? AND participant_id = ?",
            (event_id, participant_id),
        )
    else:
        db.execute(
            "INSERT INTO participations (event_id, participant_id, rsvp_status) VALUES (?, ?, 1)",
            (event_id, participant_id),
        )
    db.commit()


def signup_for_event(db: sqlite3.Connection, contact: sqlite3.Row, raw_id: str) -> list[str]:
    event_id = _parse_int(raw_id)
    if event_id is None:
        return ["Reply SIGNUP <event id>, for example SIGNUP 12."]
    event = db.execute("SELECT id, name FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return [f"I couldn't find event #{event_id}."]

    if contact["participant_id"] is not None:
        _register_participation(db, event_id, contact["participant_id"])
        return [f"You're signed up for {event['name']}! We'll message you if anything changes."]

    # First-time signup: ask for a name instead of guessing from the WhatsApp
    # profile name, which is often a nickname or missing entirely. The reply
    # to this message is picked up by dispatch()'s pending-signup check.
    _touch_contact(db, contact["id"], conversation_state=f"{_SIGNUP_NAME_STATE_PREFIX}{event_id}")
    return [f"Great! What name should we register for {event['name']}?"]


def complete_signup_with_name(
    db: sqlite3.Connection, contact: sqlite3.Row, event_id: int, name: str
) -> list[str]:
    name = name.strip()
    if not name:
        return ["Please reply with a name to finish signing up (or reply STOP to cancel)."]
    if name.upper() == "STOP":
        _touch_contact(db, contact["id"], conversation_state=None)
        return ["Signup cancelled. Reply SIGNUP <event id> if you change your mind."]

    event = db.execute("SELECT id, name FROM events WHERE id = ?", (event_id,)).fetchone()
    _touch_contact(db, contact["id"], conversation_state=None)
    if event is None:
        return ["That event isn't available anymore. Reply EVENTS to see what's on."]

    participant_id = _find_or_create_participant(db, contact, name)
    _register_participation(db, event_id, participant_id)
    return [f"Thanks, {name}! You're signed up for {event['name']}. We'll message you if anything changes."]


def my_events(db: sqlite3.Connection, contact: sqlite3.Row) -> str:
    lines: list[str] = []
    if contact["participant_id"] is not None:
        rows = db.execute(
            """
            SELECT e.id, e.name, e.event_date, pt.rsvp_status, pt.attendance
            FROM participations pt JOIN events e ON e.id = pt.event_id
            WHERE pt.participant_id = ? ORDER BY e.event_date DESC LIMIT 10
            """,
            (contact["participant_id"],),
        ).fetchall()
        if rows:
            lines.append("Your event registrations:")
            for row in rows:
                rsvp = "RSVP'd yes" if row["rsvp_status"] else "not RSVP'd"
                lines.append(f"#{row['id']} {row['name']} ({row['event_date']}) - {rsvp}")
    if contact["volunteer_id"] is not None:
        rows = db.execute(
            """
            SELECT e.id, e.name, e.event_date, vs.status
            FROM volunteer_signups vs JOIN events e ON e.id = vs.event_id
            WHERE vs.volunteer_id = ? ORDER BY e.event_date DESC LIMIT 10
            """,
            (contact["volunteer_id"],),
        ).fetchall()
        if rows:
            lines.append("Your volunteer signups:")
            for row in rows:
                lines.append(f"#{row['id']} {row['name']} ({row['event_date']}) - {row['status']}")
    if not lines:
        return "You don't have any registrations yet. Reply EVENTS to see what's coming up."
    return "\n".join(lines)


def _attended_events(db: sqlite3.Connection, contact: sqlite3.Row) -> list[dict]:
    """Events this contact has recorded attendance for, as participant or volunteer."""

    events: list[dict] = []
    if contact["participant_id"] is not None:
        rows = db.execute(
            """
            SELECT e.id, e.name FROM participations pt
            JOIN events e ON e.id = pt.event_id
            WHERE pt.participant_id = ? AND pt.attendance = 1
            ORDER BY e.event_date DESC
            """,
            (contact["participant_id"],),
        ).fetchall()
        events.extend({"id": row["id"], "name": row["name"], "role": "participant_id"} for row in rows)
    if contact["volunteer_id"] is not None:
        rows = db.execute(
            """
            SELECT e.id, e.name FROM volunteer_signups vs
            JOIN events e ON e.id = vs.event_id
            WHERE vs.volunteer_id = ? AND vs.attendance = 1
            ORDER BY e.event_date DESC
            """,
            (contact["volunteer_id"],),
        ).fetchall()
        events.extend({"id": row["id"], "name": row["name"], "role": "volunteer_id"} for row in rows)
    return events


def _issue_certificate_for(db: sqlite3.Connection, contact: sqlite3.Row, event: dict) -> str:
    if event["role"] == "participant_id":
        row = ensure_certificate(db, event["id"], participant_id=contact["participant_id"])
    else:
        row = ensure_certificate(db, event["id"], volunteer_id=contact["volunteer_id"])
    return f"Here's your certificate: {certificate_link(row['download_token'])}"


def request_certificate(db: sqlite3.Connection, contact: sqlite3.Row, raw_id: str | None) -> str:
    event_id = _parse_int(raw_id) if raw_id else None

    if event_id is None:
        events = _attended_events(db, contact)
        if not events:
            return (
                "I don't see attendance recorded for you at any event yet, "
                "so a certificate isn't available."
            )
        if len(events) == 1:
            return _issue_certificate_for(db, contact, events[0])
        lines = ["You attended more than one event. Reply CERT <event id> to pick one:"]
        for event in events:
            lines.append(f"#{event['id']} {event['name']}")
        return "\n".join(lines)

    if contact["participant_id"] is not None:
        attended = db.execute(
            "SELECT attendance FROM participations WHERE event_id = ? AND participant_id = ?",
            (event_id, contact["participant_id"]),
        ).fetchone()
        if attended is not None and attended["attendance"] == 1:
            return _issue_certificate_for(db, contact, {"id": event_id, "role": "participant_id"})
    if contact["volunteer_id"] is not None:
        attended = db.execute(
            "SELECT attendance FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
            (event_id, contact["volunteer_id"]),
        ).fetchone()
        if attended is not None and attended["attendance"] == 1:
            return _issue_certificate_for(db, contact, {"id": event_id, "role": "volunteer_id"})
    return "I don't see attendance recorded for you at that event yet, so a certificate isn't available."


def ensure_certificate(
    db: sqlite3.Connection,
    event_id: int,
    participant_id: int | None = None,
    volunteer_id: int | None = None,
) -> sqlite3.Row:
    column = "participant_id" if participant_id is not None else "volunteer_id"
    person_id = participant_id if participant_id is not None else volunteer_id
    existing = db.execute(
        f"SELECT * FROM certificates WHERE event_id = ? AND {column} = ?",
        (event_id, person_id),
    ).fetchone()
    if existing is not None:
        return existing
    token = secrets.token_urlsafe(16)
    row = db.execute(
        f"""
        INSERT INTO certificates (event_id, {column}, download_token)
        VALUES (?, ?, ?) RETURNING *
        """,
        (event_id, person_id, token),
    ).fetchone()
    db.commit()
    return row


# --------------------------------------------------------------------------- #
# Volunteer commands
# --------------------------------------------------------------------------- #
def _register_volunteer_signup(db: sqlite3.Connection, event: sqlite3.Row, volunteer_id: int) -> list[str]:
    already = db.execute(
        "SELECT status FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
        (event["id"], volunteer_id),
    ).fetchone()
    if already is not None:
        return [f"You already have a volunteer request for {event['name']} ({already['status']})."]
    db.execute(
        "INSERT INTO volunteer_signups (event_id, volunteer_id, status) VALUES (?, ?, 'requested')",
        (event["id"], volunteer_id),
    )
    db.commit()
    return [
        f"Thanks for volunteering for {event['name']}! An organizer will review your request "
        "and confirm your role."
    ]


def volunteer_registration_link() -> str:
    base = os.environ.get("PASSION_FRONTEND_BASE_URL", os.environ.get("PASSION_PUBLIC_BASE_URL", "http://localhost:5173")).rstrip("/")
    return f"{base}/volunteer-register"


def volunteer_signup(db: sqlite3.Connection, contact: sqlite3.Row, raw_id: str) -> list[str]:
    event_id = _parse_int(raw_id)
    if event_id is None:
        return ["Reply VOLUNTEER SIGNUP <event id>, for example VOLUNTEER SIGNUP 12."]
    event = db.execute("SELECT id, name FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return [f"I couldn't find event #{event_id}."]

    if contact["volunteer_id"] is not None:
        return _register_volunteer_signup(db, event, contact["volunteer_id"])

    existing = db.execute(
        "SELECT id FROM volunteers WHERE contact_number = ?", (contact["phone_number"],)
    ).fetchone()
    if existing is not None:
        _touch_contact(db, contact["id"], volunteer_id=existing["id"])
        return _register_volunteer_signup(db, event, existing["id"])

    # Becoming a volunteer (as opposed to signing up for an individual event)
    # only happens on the website now, so it goes through phone-number OTP
    # verification. The bot doesn't create volunteer profiles from a chat
    # reply anymore — point them to the registration form instead.
    return [
        "You'll need a volunteer account first — it only takes a minute. "
        f"Register here: {volunteer_registration_link()}\n"
        f"Once you're registered and verified, reply VOLUNTEER SIGNUP {event_id} again."
    ]


def volunteer_tasks(db: sqlite3.Connection, contact: sqlite3.Row) -> str:
    if contact["volunteer_id"] is None:
        return "You don't have a volunteer profile yet. Reply VOLUNTEER SIGNUP <event id> to apply."
    rows = db.execute(
        """
        SELECT vs.id AS signup_id, e.name AS event_name, e.event_date, e.venue,
               vs.status, r.name AS role_name, vs.confirmed_at
        FROM volunteer_signups vs
        JOIN events e ON e.id = vs.event_id
        LEFT JOIN roles r ON r.id = vs.assigned_role_id
        WHERE vs.volunteer_id = ? AND vs.status != 'rejected'
        ORDER BY e.event_date
        """,
        (contact["volunteer_id"],),
    ).fetchall()
    if not rows:
        return "You don't have any active volunteer assignments."
    lines = ["Your volunteer assignments:"]
    for row in rows:
        role = row["role_name"] or "role not yet assigned"
        if row["status"] == "approved":
            confirmed = "confirmed" if row["confirmed_at"] else "reply CONFIRM {} to confirm".format(row["signup_id"])
            lines.append(
                f"#{row['signup_id']} {row['event_name']} ({row['event_date']} @ {row['venue']}) "
                f"- {role} - {confirmed}"
            )
        else:
            lines.append(
                f"#{row['signup_id']} {row['event_name']} ({row['event_date']}) - awaiting approval"
            )
    return "\n".join(lines)


def confirm_assignment(db: sqlite3.Connection, contact: sqlite3.Row, raw_id: str) -> str:
    signup_id = _parse_int(raw_id)
    if signup_id is None or contact["volunteer_id"] is None:
        return "Reply CONFIRM <assignment id> to confirm a shift, for example CONFIRM 4."
    row = db.execute(
        "SELECT status, confirmed_at FROM volunteer_signups WHERE id = ? AND volunteer_id = ?",
        (signup_id, contact["volunteer_id"]),
    ).fetchone()
    if row is None:
        return f"I couldn't find assignment #{signup_id} for you."
    if row["status"] != "approved":
        return "That assignment hasn't been approved yet, so there's nothing to confirm."
    if row["confirmed_at"]:
        return "You've already confirmed this assignment."
    db.execute(
        "UPDATE volunteer_signups SET confirmed_at = CURRENT_TIMESTAMP WHERE id = ?",
        (signup_id,),
    )
    db.commit()
    return "Thanks, your assignment is confirmed!"


# --------------------------------------------------------------------------- #
# Admin commands
# --------------------------------------------------------------------------- #
def audience_contacts(db: sqlite3.Connection, event_id: int | None, audience: str) -> list[sqlite3.Row]:
    if event_id is None or audience == "all":
        return db.execute("SELECT * FROM whatsapp_contacts WHERE notify_new_events = 1").fetchall()
    if audience == "volunteers":
        return db.execute(
            """
            SELECT wc.* FROM whatsapp_contacts wc
            JOIN volunteer_signups vs ON vs.volunteer_id = wc.volunteer_id
            WHERE vs.event_id = ? AND vs.status = 'approved'
            """,
            (event_id,),
        ).fetchall()
    return db.execute(
        """
        SELECT wc.* FROM whatsapp_contacts wc
        JOIN participations pt ON pt.participant_id = wc.participant_id
        WHERE pt.event_id = ? AND pt.rsvp_status = 1 AND wc.notify_new_events = 1
        UNION
        SELECT wc.* FROM whatsapp_contacts wc
        JOIN volunteer_signups vs ON vs.volunteer_id = wc.volunteer_id
        WHERE vs.event_id = ? AND vs.status = 'approved'
        """,
        (event_id, event_id),
    ).fetchall()


def _announcement_sender_name(db: sqlite3.Connection, announcement: sqlite3.Row) -> str:
    if announcement["created_by_team_member_id"] is not None:
        row = db.execute(
            "SELECT name FROM team_members WHERE id = ?",
            (announcement["created_by_team_member_id"],),
        ).fetchone()
        if row is not None:
            return row["name"]
    return "Passion to Serve"


def format_announcement_message(db: sqlite3.Connection, announcement: sqlite3.Row) -> str:
    """One WhatsApp message combining who it's from, the title, and the body."""

    sender = _announcement_sender_name(db, announcement)
    label = "Reminder" if announcement["kind"] == "reminder" else "Announcement"
    return (
        f"{label} from {sender}\n"
        f"{announcement['title']}\n\n"
        f"{announcement['body']}"
    )


def send_announcement(db: sqlite3.Connection, announcement_id: int, client=None) -> int:
    """Deliver a pending announcement to its audience; returns delivery count."""

    client = client or get_client()
    announcement = db.execute(
        "SELECT * FROM announcements WHERE id = ?", (announcement_id,)
    ).fetchone()
    if announcement is None:
        logger.warning("send_announcement called with unknown announcement id %s", announcement_id)
        return 0
    message = format_announcement_message(db, announcement)
    contacts = audience_contacts(db, announcement["event_id"], announcement["audience"])
    logger.info(
        "Delivering announcement %s (%r) to %d contact(s), audience=%s",
        announcement_id,
        announcement["title"],
        len(contacts),
        announcement["audience"],
    )
    sent = 0
    failed = 0
    for contact in contacts:
        try:
            client.send_text(contact["phone_number"], message)
            status = "sent"
            error = None
            sent += 1
        except Exception as error_instance:  # pragma: no cover - network failure path
            status = "failed"
            error = str(error_instance)
            failed += 1
            logger.warning(
                "Announcement %s delivery to %s failed: %s",
                announcement_id,
                contact["phone_number"],
                error_instance,
            )
        db.execute(
            """
            INSERT INTO announcement_deliveries
                (announcement_id, whatsapp_contact_id, status, error, sent_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (announcement_id, whatsapp_contact_id)
            DO UPDATE SET status = excluded.status, error = excluded.error, sent_at = excluded.sent_at
            """,
            (announcement_id, contact["id"], status, error),
        )
    db.execute(
        "UPDATE announcements SET sent_at = CURRENT_TIMESTAMP WHERE id = ?",
        (announcement_id,),
    )
    db.commit()
    logger.info(
        "Announcement %s delivery complete: %d sent, %d failed", announcement_id, sent, failed
    )
    return sent


def admin_broadcast(db: sqlite3.Connection, contact: sqlite3.Row, target: str, message: str) -> str:
    event_id = None
    audience = "all"
    if target.upper() != "ALL":
        event_id = _parse_int(target)
        if event_id is None:
            return "Reply BROADCAST <event id|ALL> <message>."
        if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
            return f"I couldn't find event #{event_id}."
        audience = "all"
    announcement_id = db.execute(
        """
        INSERT INTO announcements (event_id, title, body, audience, kind, created_by_team_member_id)
        VALUES (?, 'Broadcast', ?, ?, 'announcement', ?) RETURNING id
        """,
        (event_id, message, audience, contact["team_member_id"]),
    ).fetchone()["id"]
    db.commit()
    sent = send_announcement(db, announcement_id)
    return f"Broadcast sent to {sent} recipient(s)."


def admin_remind(db: sqlite3.Connection, contact: sqlite3.Row, raw_id: str) -> str:
    event_id = _parse_int(raw_id)
    if event_id is None:
        return "Reply REMIND <event id>."
    event = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return f"I couldn't find event #{event_id}."
    body = (
        f"Reminder: you're assigned to {event['name']} on {event['event_date']} "
        f"at {event['venue']}. Reply TASKS for details."
    )
    announcement_id = db.execute(
        """
        INSERT INTO announcements (event_id, title, body, audience, kind, created_by_team_member_id)
        VALUES (?, 'Shift reminder', ?, 'volunteers', 'reminder', ?) RETURNING id
        """,
        (event_id, body, contact["team_member_id"]),
    ).fetchone()["id"]
    db.commit()
    sent = send_announcement(db, announcement_id)
    return f"Reminder sent to {sent} approved volunteer(s)."


def admin_pending(db: sqlite3.Connection, raw_id: str) -> str:
    event_id = _parse_int(raw_id)
    if event_id is None:
        return "Reply PENDING <event id>, for example PENDING 3."
    rows = db.execute(
        """
        SELECT vs.id, v.name, v.contact_number
        FROM volunteer_signups vs JOIN volunteers v ON v.id = vs.volunteer_id
        WHERE vs.event_id = ? AND vs.status = 'requested'
        ORDER BY vs.id
        """,
        (event_id,),
    ).fetchall()
    if not rows:
        return f"No pending volunteer requests for event #{event_id}."
    lines = [f"Pending requests for event #{event_id}:"]
    for row in rows:
        lines.append(f"Request #{row['id']}: {row['name']} ({row['contact_number'] or 'no phone'})")

    roles = db.execute(
        """
        SELECT r.id, r.name FROM template_roles tr
        JOIN events e ON e.event_template_id = tr.event_template_id
        JOIN roles r ON r.id = tr.role_id
        WHERE e.id = ? ORDER BY r.name
        """,
        (event_id,),
    ).fetchall()
    if roles:
        lines.append("")
        lines.append("Roles available for this event:")
        for role in roles:
            lines.append(f"Role #{role['id']}: {role['name']}")
    else:
        lines.append("")
        lines.append("(No volunteer roles are set up for this event yet.)")

    lines.append("")
    lines.append(
        "To approve: reply APPROVE followed by the request number then the role "
        "number, for example APPROVE {} {}.".format(
            rows[0]["id"], roles[0]["id"] if roles else "<role number>"
        )
    )
    lines.append("To turn someone down: reply REJECT followed by the request number, "
                  "for example REJECT {}.".format(rows[0]["id"]))
    return "\n".join(lines)


def admin_approve(db: sqlite3.Connection, raw_signup_id: str, raw_role_id: str) -> str:
    signup_id = _parse_int(raw_signup_id)
    role_id = _parse_int(raw_role_id)
    if signup_id is None or role_id is None:
        return "Reply APPROVE <signup id> <role id>."
    signup = db.execute("SELECT * FROM volunteer_signups WHERE id = ?", (signup_id,)).fetchone()
    if signup is None:
        return f"I couldn't find volunteer request #{signup_id}."
    valid_role = db.execute(
        """
        SELECT 1 FROM template_roles tr
        JOIN events e ON e.event_template_id = tr.event_template_id
        WHERE e.id = ? AND tr.role_id = ?
        """,
        (signup["event_id"], role_id),
    ).fetchone()
    if valid_role is None:
        return (
            f"Role #{role_id} isn't available for that event. "
            f"Reply PENDING {signup['event_id']} to see the request and role numbers again."
        )
    db.execute(
        "UPDATE volunteer_signups SET status = 'approved', assigned_role_id = ? WHERE id = ?",
        (role_id, signup_id),
    )
    db.commit()
    volunteer_contact = db.execute(
        "SELECT phone_number FROM whatsapp_contacts WHERE volunteer_id = ?",
        (signup["volunteer_id"],),
    ).fetchone()
    if volunteer_contact is not None:
        try:
            get_client().send_text(
                volunteer_contact["phone_number"],
                "Good news! Your volunteer request was approved. Reply TASKS to see your assignment.",
            )
        except Exception:
            # The approval itself already succeeded and was committed above;
            # a failed courtesy notification shouldn't make APPROVE look like
            # it failed to the admin. Just log it for follow-up.
            logger.exception(
                "Approved signup %s but failed to notify volunteer at %s",
                signup_id,
                volunteer_contact["phone_number"],
            )
    return f"Approved request #{signup_id}."


def admin_reject(db: sqlite3.Connection, raw_signup_id: str) -> str:
    signup_id = _parse_int(raw_signup_id)
    if signup_id is None:
        return "Reply REJECT <signup id>."
    row = db.execute("SELECT id FROM volunteer_signups WHERE id = ?", (signup_id,)).fetchone()
    if row is None:
        return f"I couldn't find volunteer request #{signup_id}."
    db.execute(
        "UPDATE volunteer_signups SET status = 'rejected', assigned_role_id = NULL WHERE id = ?",
        (signup_id,),
    )
    db.commit()
    return f"Rejected request #{signup_id}."


def admin_attendance(db: sqlite3.Connection, raw_event_id: str, phone: str, volunteer: bool) -> str:
    event_id = _parse_int(raw_event_id)
    if event_id is None:
        keyword = "MARK" if volunteer else "ATTEND"
        return f"Reply {keyword} <event id> <phone number>."
    if volunteer:
        person = db.execute(
            "SELECT id, name FROM volunteers WHERE contact_number = ?", (phone,)
        ).fetchone()
        if person is None:
            return f"No volunteer found with phone {phone}."
        row = db.execute(
            "SELECT id FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
            (event_id, person["id"]),
        ).fetchone()
        if row is None:
            return f"{person['name']} isn't signed up for event #{event_id}."
        db.execute(
            "UPDATE volunteer_signups SET attendance = 1 WHERE id = ?", (row["id"],)
        )
    else:
        person = db.execute(
            "SELECT id, name FROM participants WHERE contact_number = ?", (phone,)
        ).fetchone()
        if person is None:
            return f"No participant found with phone {phone}."
        row = db.execute(
            "SELECT 1 FROM participations WHERE event_id = ? AND participant_id = ?",
            (event_id, person["id"]),
        ).fetchone()
        if row is None:
            db.execute(
                "INSERT INTO participations (event_id, participant_id, rsvp_status, attendance) VALUES (?, ?, 1, 1)",
                (event_id, person["id"]),
            )
        else:
            db.execute(
                "UPDATE participations SET attendance = 1 WHERE event_id = ? AND participant_id = ?",
                (event_id, person["id"]),
            )
    db.commit()
    return f"Marked {person['name']} present for event #{event_id}."
