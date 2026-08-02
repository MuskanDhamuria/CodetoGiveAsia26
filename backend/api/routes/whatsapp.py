"""WhatsApp bot webhook, organizer announcements/reminders, and certificates.

Implements the "Announcements, reminders, and bots" and "Certificates"
sections proposed in `backend/API_ENDPOINTS.md`, using the Meta WhatsApp
Cloud API (see `backend/integrations/whatsapp_client.py`).
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse, PlainTextResponse

from backend.api.routes._common import Connection
from backend.bot.commands import (
    dispatch,
    ensure_certificate,
    get_or_create_contact,
    send_announcement,
)
from backend.integrations.whatsapp_client import (
    verify_webhook_challenge,
    verify_webhook_signature,
)
from backend.schema.whatsapp import (
    AnnouncementCreate,
    AnnouncementOut,
    CertificateCandidateOut,
    CertificateOut,
    CertificateSendIn,
    NotificationSubscriptionCreate,
    NotificationSubscriptionOut,
    ReminderCreate,
    TeamMemberWhatsAppLinkCreate,
    TeamMemberWhatsAppLinkOut,
)
from backend.bot.commands import certificate_link

logger = logging.getLogger(__name__)

router = APIRouter(tags=["whatsapp"])


# --------------------------------------------------------------------------- #
# Webhook
# --------------------------------------------------------------------------- #
@router.get("/integrations/whatsapp/webhook", summary="Meta webhook verification handshake")
def verify_whatsapp_webhook(
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> Response:
    if verify_webhook_challenge(hub_mode, hub_verify_token):
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(status_code=403, detail="Webhook verification failed")


@router.post("/integrations/whatsapp/webhook", summary="Receive inbound WhatsApp messages")
async def receive_whatsapp_webhook(request: Request, db: Connection) -> dict:
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not verify_webhook_signature(raw_body, signature):
        # verify_webhook_signature already logs why (missing/malformed header,
        # or a mismatch — check WHATSAPP_APP_SECRET if this is unexpected).
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except ValueError:
        logger.warning("Received WhatsApp webhook with a body that isn't valid JSON")
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    entries = payload.get("entry", [])
    logger.info("Received WhatsApp webhook: %d entr%s", len(entries), "y" if len(entries) == 1 else "ies")

    client = None
    for entry in entries:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            contacts_meta = {
                contact.get("wa_id"): contact.get("profile", {}).get("name")
                for contact in value.get("contacts", [])
            }
            for message in value.get("messages", []):
                phone_number = message.get("from")
                if not phone_number:
                    logger.warning("Skipping WhatsApp message with no 'from' phone number: %r", message)
                    continue

                text = ""
                if message.get("type") == "text":
                    text = message.get("text", {}).get("body", "")
                else:
                    logger.info(
                        "Ignoring unsupported WhatsApp message type %r from %s",
                        message.get("type"),
                        phone_number,
                    )

                contact = get_or_create_contact(db, phone_number)
                display_name = contacts_meta.get(phone_number)
                if display_name and not contact["display_name"]:
                    db.execute(
                        "UPDATE whatsapp_contacts SET display_name = ? WHERE id = ?",
                        (display_name, contact["id"]),
                    )
                    db.commit()
                    contact = get_or_create_contact(db, phone_number)

                logger.info("Inbound WhatsApp message from %s: %r", phone_number, text)
                db.execute(
                    """
                    INSERT INTO whatsapp_messages (contact_id, direction, wa_message_id, body)
                    VALUES (?, 'inbound', ?, ?)
                    """,
                    (contact["id"], message.get("id"), text),
                )
                db.commit()

                try:
                    replies = dispatch(db, contact, text)
                except Exception:
                    # A bug in one command shouldn't take down the whole
                    # webhook batch (Meta will retry a 500) or silently drop
                    # every other message in this payload.
                    logger.exception(
                        "Bot dispatch raised an exception handling %r from %s", text, phone_number
                    )
                    continue

                if client is None:
                    from backend.integrations.whatsapp_client import get_client

                    client = get_client()
                for reply in replies:
                    try:
                        sent = client.send_text(phone_number, reply)
                    except Exception:
                        # send_text already logs the specific HTTP/network
                        # failure; log here too so it's obvious a reply to
                        # this phone number never went out.
                        logger.exception("Failed to send WhatsApp reply to %s", phone_number)
                        continue
                    db.execute(
                        """
                        INSERT INTO whatsapp_messages (contact_id, direction, wa_message_id, body)
                        VALUES (?, 'outbound', ?, ?)
                        """,
                        (contact["id"], sent.wa_message_id, reply),
                    )
                db.commit()
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Announcements and reminders
# --------------------------------------------------------------------------- #
def _require_event(db: sqlite3.Connection, event_id: int) -> None:
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} was not found")


def _announcement_model(db: sqlite3.Connection, row: sqlite3.Row) -> AnnouncementOut:
    counts = db.execute(
        """
        SELECT
            COALESCE(SUM(status = 'sent'), 0) AS delivered_count,
            COALESCE(SUM(status = 'failed'), 0) AS failed_count
        FROM announcement_deliveries WHERE announcement_id = ?
        """,
        (row["id"],),
    ).fetchone()
    return AnnouncementOut(
        id=row["id"],
        event_id=row["event_id"],
        title=row["title"],
        body=row["body"],
        audience=row["audience"],
        kind=row["kind"],
        created_by_team_member_id=row["created_by_team_member_id"],
        created_at=row["created_at"],
        sent_at=row["sent_at"],
        delivered_count=counts["delivered_count"],
        failed_count=counts["failed_count"],
    )


@router.post(
    "/events/{event_id}/announcements",
    response_model=AnnouncementOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create and immediately send an announcement to an event's audience",
)
def create_announcement(
    event_id: int, payload: AnnouncementCreate, db: Connection
) -> AnnouncementOut:
    _require_event(db, event_id)
    row = db.execute(
        """
        INSERT INTO announcements
            (event_id, title, body, audience, kind, created_by_team_member_id)
        VALUES (?, ?, ?, ?, 'announcement', ?) RETURNING id
        """,
        (
            event_id,
            payload.title,
            payload.body,
            payload.audience,
            payload.created_by_team_member_id,
        ),
    ).fetchone()
    db.commit()
    send_announcement(db, row["id"])
    return _announcement_model(
        db, db.execute("SELECT * FROM announcements WHERE id = ?", (row["id"],)).fetchone()
    )


@router.get(
    "/events/{event_id}/announcements",
    response_model=list[AnnouncementOut],
    summary="List announcements and reminders sent for an event",
)
def list_announcements(event_id: int, db: Connection) -> list[AnnouncementOut]:
    _require_event(db, event_id)
    rows = db.execute(
        "SELECT * FROM announcements WHERE event_id = ? ORDER BY id DESC", (event_id,)
    ).fetchall()
    return [_announcement_model(db, row) for row in rows]


def default_reminder_body(event: sqlite3.Row) -> str:
    return (
        f"Reminder: you're assigned to {event['name']} on {event['event_date']} "
        f"at {event['venue']}. Reply TASKS for details."
    )


@router.post(
    "/events/{event_id}/reminders",
    response_model=AnnouncementOut,
    status_code=status.HTTP_201_CREATED,
    summary="Send a shift reminder to a event's approved volunteers",
)
def create_reminder(event_id: int, payload: ReminderCreate, db: Connection) -> AnnouncementOut:
    event = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} was not found")
    body = payload.body or default_reminder_body(event)
    row = db.execute(
        """
        INSERT INTO announcements
            (event_id, title, body, audience, kind, created_by_team_member_id)
        VALUES (?, 'Shift reminder', ?, 'volunteers', 'reminder', ?) RETURNING id
        """,
        (event_id, body, payload.created_by_team_member_id),
    ).fetchone()
    db.commit()
    send_announcement(db, row["id"])
    return _announcement_model(
        db, db.execute("SELECT * FROM announcements WHERE id = ?", (row["id"],)).fetchone()
    )


# --------------------------------------------------------------------------- #
# Certificates
# --------------------------------------------------------------------------- #
def _certificate_model(row: sqlite3.Row) -> CertificateOut:
    return CertificateOut(
        id=row["id"],
        event_id=row["event_id"],
        participant_id=row["participant_id"],
        volunteer_id=row["volunteer_id"],
        download_token=row["download_token"],
        issued_at=row["issued_at"],
        delivered_at=row["delivered_at"],
        link=certificate_link(row["download_token"]),
    )


def certificate_recipient_counts(db: sqlite3.Connection, event_id: int) -> dict:
    """Read-only preview of what generate_certificates would do — same

    attendance filters as its two loops, but counting only, no writes.
    """

    participant_total = db.execute(
        "SELECT COUNT(*) FROM participations WHERE event_id = ? AND attendance = 1",
        (event_id,),
    ).fetchone()[0]
    participant_already_delivered = db.execute(
        """
        SELECT COUNT(*) FROM certificates
        WHERE event_id = ? AND participant_id IS NOT NULL AND delivered_at IS NOT NULL
        """,
        (event_id,),
    ).fetchone()[0]
    volunteer_total = db.execute(
        "SELECT COUNT(*) FROM volunteer_signups WHERE event_id = ? AND attendance = 1",
        (event_id,),
    ).fetchone()[0]
    volunteer_already_delivered = db.execute(
        """
        SELECT COUNT(*) FROM certificates
        WHERE event_id = ? AND volunteer_id IS NOT NULL AND delivered_at IS NOT NULL
        """,
        (event_id,),
    ).fetchone()[0]
    return {
        "event_id": event_id,
        "eligible_participants": participant_total,
        "eligible_volunteers": volunteer_total,
        "already_delivered": participant_already_delivered + volunteer_already_delivered,
        "pending_delivery": (
            participant_total
            + volunteer_total
            - participant_already_delivered
            - volunteer_already_delivered
        ),
    }


@router.post(
    "/events/{event_id}/certificates/generate",
    response_model=list[CertificateOut],
    summary="Generate certificates for everyone with recorded attendance and message the links",
)
def generate_certificates(event_id: int, db: Connection) -> list[CertificateOut]:
    _require_event(db, event_id)
    from backend.integrations.whatsapp_client import get_client

    client = get_client()
    certificates: list[sqlite3.Row] = []

    for row in db.execute(
        "SELECT participant_id FROM participations WHERE event_id = ? AND attendance = 1",
        (event_id,),
    ).fetchall():
        certificate = ensure_certificate(db, event_id, participant_id=row["participant_id"])
        certificates.append(certificate)
        contact = db.execute(
            "SELECT phone_number FROM whatsapp_contacts WHERE participant_id = ?",
            (row["participant_id"],),
        ).fetchone()
        if contact is not None and certificate["delivered_at"] is None:
            try:
                client.send_text(
                    contact["phone_number"],
                    f"Thanks for attending! Here's your certificate: {certificate_link(certificate['download_token'])}",
                )
            except Exception:
                logger.exception(
                    "Failed to deliver certificate %s to participant %s",
                    certificate["id"],
                    row["participant_id"],
                )
            else:
                db.execute(
                    "UPDATE certificates SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (certificate["id"],),
                )

    for row in db.execute(
        "SELECT volunteer_id FROM volunteer_signups WHERE event_id = ? AND attendance = 1",
        (event_id,),
    ).fetchall():
        certificate = ensure_certificate(db, event_id, volunteer_id=row["volunteer_id"])
        certificates.append(certificate)
        contact = db.execute(
            "SELECT phone_number FROM whatsapp_contacts WHERE volunteer_id = ?",
            (row["volunteer_id"],),
        ).fetchone()
        if contact is not None and certificate["delivered_at"] is None:
            try:
                client.send_text(
                    contact["phone_number"],
                    f"Thanks for volunteering! Here's your certificate: {certificate_link(certificate['download_token'])}",
                )
            except Exception:
                logger.exception(
                    "Failed to deliver certificate %s to volunteer %s",
                    certificate["id"],
                    row["volunteer_id"],
                )
            else:
                db.execute(
                    "UPDATE certificates SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (certificate["id"],),
                )
    db.commit()
    return [
        _certificate_model(
            db.execute("SELECT * FROM certificates WHERE id = ?", (certificate["id"],)).fetchone()
        )
        for certificate in certificates
    ]


@router.get(
    "/events/{event_id}/certificate-candidates",
    response_model=list[CertificateCandidateOut],
    summary="List everyone registered for an event, for the manual certificate picker",
)
def certificate_candidates(event_id: int, db: Connection) -> list[CertificateCandidateOut]:
    _require_event(db, event_id)
    candidates: list[CertificateCandidateOut] = []

    for row in db.execute(
        """
        SELECT p.id, p.name, pt.attendance,
               c.id AS certificate_id, c.delivered_at
        FROM participations pt
        JOIN participants p ON p.id = pt.participant_id
        LEFT JOIN certificates c ON c.event_id = ? AND c.participant_id = p.id
        WHERE pt.event_id = ?
        ORDER BY p.name
        """,
        (event_id, event_id),
    ).fetchall():
        candidates.append(
            CertificateCandidateOut(
                type="participant",
                id=row["id"],
                name=row["name"],
                attended=bool(row["attendance"]),
                already_issued=row["certificate_id"] is not None,
                already_delivered=row["delivered_at"] is not None,
            )
        )

    for row in db.execute(
        """
        SELECT v.id, v.name, vs.attendance,
               c.id AS certificate_id, c.delivered_at
        FROM volunteer_signups vs
        JOIN volunteers v ON v.id = vs.volunteer_id
        LEFT JOIN certificates c ON c.event_id = ? AND c.volunteer_id = v.id
        WHERE vs.event_id = ?
        ORDER BY v.name
        """,
        (event_id, event_id),
    ).fetchall():
        candidates.append(
            CertificateCandidateOut(
                type="volunteer",
                id=row["id"],
                name=row["name"],
                attended=bool(row["attendance"]),
                already_issued=row["certificate_id"] is not None,
                already_delivered=row["delivered_at"] is not None,
            )
        )

    return candidates


@router.post(
    "/events/{event_id}/certificates/send",
    response_model=list[CertificateOut],
    summary="Generate (if needed) and send certificates to specifically chosen registrants",
)
def send_certificates(
    event_id: int, payload: CertificateSendIn, db: Connection
) -> list[CertificateOut]:
    """Manual counterpart to POST .../certificates/generate.

    That endpoint only ever considers people with recorded attendance;
    admins asked for a way to pick recipients themselves — e.g. someone
    whose attendance wasn't scanned in time, or excluding a no-show who was
    still marked present by mistake. Always (re)sends to whoever is listed,
    regardless of prior delivery, since picking someone here is an explicit
    request to message them.
    """

    _require_event(db, event_id)
    if not payload.recipients:
        raise HTTPException(status_code=400, detail="Select at least one recipient")
    from backend.integrations.whatsapp_client import get_client

    client = get_client()
    certificate_ids: list[int] = []

    for recipient in payload.recipients:
        if recipient.type == "participant":
            registered = db.execute(
                "SELECT 1 FROM participations WHERE event_id = ? AND participant_id = ?",
                (event_id, recipient.id),
            ).fetchone()
            if registered is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Participant #{recipient.id} isn't registered for this event",
                )
            certificate = ensure_certificate(db, event_id, participant_id=recipient.id)
            contact = db.execute(
                "SELECT phone_number FROM whatsapp_contacts WHERE participant_id = ?",
                (recipient.id,),
            ).fetchone()
            message = f"Thanks for attending! Here's your certificate: {certificate_link(certificate['download_token'])}"
        else:
            registered = db.execute(
                "SELECT 1 FROM volunteer_signups WHERE event_id = ? AND volunteer_id = ?",
                (event_id, recipient.id),
            ).fetchone()
            if registered is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Volunteer #{recipient.id} isn't signed up for this event",
                )
            certificate = ensure_certificate(db, event_id, volunteer_id=recipient.id)
            contact = db.execute(
                "SELECT phone_number FROM whatsapp_contacts WHERE volunteer_id = ?",
                (recipient.id,),
            ).fetchone()
            message = f"Thanks for volunteering! Here's your certificate: {certificate_link(certificate['download_token'])}"

        certificate_ids.append(certificate["id"])
        if contact is not None:
            try:
                client.send_text(contact["phone_number"], message)
            except Exception:
                logger.exception(
                    "Failed to deliver certificate %s to %s %s",
                    certificate["id"],
                    recipient.type,
                    recipient.id,
                )
            else:
                db.execute(
                    "UPDATE certificates SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (certificate["id"],),
                )
    db.commit()
    return [
        _certificate_model(db.execute("SELECT * FROM certificates WHERE id = ?", (cid,)).fetchone())
        for cid in certificate_ids
    ]


@router.get(
    "/events/{event_id}/certificates",
    response_model=list[CertificateOut],
    summary="List certificates issued for an event",
)
def list_certificates(event_id: int, db: Connection) -> list[CertificateOut]:
    _require_event(db, event_id)
    rows = db.execute(
        "SELECT * FROM certificates WHERE event_id = ? ORDER BY id", (event_id,)
    ).fetchall()
    return [_certificate_model(row) for row in rows]


@router.get(
    "/public/certificates/{download_token}",
    summary="Public printable certificate page",
    response_class=HTMLResponse,
)
def get_public_certificate(download_token: str, db: Connection) -> HTMLResponse:
    certificate = db.execute(
        "SELECT * FROM certificates WHERE download_token = ?", (download_token,)
    ).fetchone()
    if certificate is None:
        raise HTTPException(status_code=404, detail="Certificate not found")
    event = db.execute(
        "SELECT name, event_date FROM events WHERE id = ?", (certificate["event_id"],)
    ).fetchone()
    if certificate["participant_id"] is not None:
        person = db.execute(
            "SELECT name FROM participants WHERE id = ?", (certificate["participant_id"],)
        ).fetchone()
    else:
        person = db.execute(
            "SELECT name FROM volunteers WHERE id = ?", (certificate["volunteer_id"],)
        ).fetchone()
    person_name = person["name"] if person else "Participant"
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <title>Certificate of Participation</title>
        <style>
            body {{ font-family: Georgia, serif; text-align: center; padding: 64px; }}
            .certificate {{
                border: 8px solid #2c5f2d; padding: 48px; max-width: 700px; margin: 0 auto;
            }}
            h1 {{ font-size: 28px; color: #2c5f2d; }}
            .name {{ font-size: 32px; margin: 24px 0; }}
            .meta {{ color: #555; }}
        </style>
    </head>
    <body>
        <div class="certificate">
            <h1>Certificate of Participation</h1>
            <p>This certifies that</p>
            <div class="name">{person_name}</div>
            <p>participated in</p>
            <p><strong>{event['name']}</strong></p>
            <p class="meta">{event['event_date']}</p>
            <p class="meta">Issued {certificate['issued_at']}</p>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html)


# --------------------------------------------------------------------------- #
# Team-member WhatsApp linking (grants bot admin commands)
# --------------------------------------------------------------------------- #
def _require_team_member(db: sqlite3.Connection, member_id: int) -> None:
    if db.execute("SELECT 1 FROM team_members WHERE id = ?", (member_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Team member {member_id} was not found")


def _link_model(row: sqlite3.Row) -> TeamMemberWhatsAppLinkOut:
    return TeamMemberWhatsAppLinkOut(
        whatsapp_contact_id=row["id"],
        team_member_id=row["team_member_id"],
        phone_number=row["phone_number"],
    )


@router.post(
    "/team-members/{member_id}/whatsapp-link",
    response_model=TeamMemberWhatsAppLinkOut,
    status_code=status.HTTP_201_CREATED,
    summary="Link a phone number to a team member, unlocking bot admin commands",
)
def link_team_member_whatsapp(
    member_id: int, payload: TeamMemberWhatsAppLinkCreate, db: Connection
) -> TeamMemberWhatsAppLinkOut:
    _require_team_member(db, member_id)
    contact = get_or_create_contact(db, payload.phone_number)
    if contact["team_member_id"] is not None and contact["team_member_id"] != member_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That phone number is already linked to a different team member",
        )
    db.execute(
        "UPDATE whatsapp_contacts SET team_member_id = ? WHERE id = ?",
        (member_id, contact["id"]),
    )
    db.commit()
    row = db.execute(
        "SELECT * FROM whatsapp_contacts WHERE id = ?", (contact["id"],)
    ).fetchone()
    return _link_model(row)


@router.get(
    "/team-members/{member_id}/whatsapp-link",
    response_model=TeamMemberWhatsAppLinkOut,
    summary="Get the phone number linked to a team member, if any",
)
def get_team_member_whatsapp(member_id: int, db: Connection) -> TeamMemberWhatsAppLinkOut:
    _require_team_member(db, member_id)
    row = db.execute(
        "SELECT * FROM whatsapp_contacts WHERE team_member_id = ?", (member_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No WhatsApp number linked to this team member")
    return _link_model(row)


@router.delete(
    "/team-members/{member_id}/whatsapp-link",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a team member's WhatsApp admin link",
)
def unlink_team_member_whatsapp(member_id: int, db: Connection) -> Response:
    _require_team_member(db, member_id)
    row = db.execute(
        "SELECT id FROM whatsapp_contacts WHERE team_member_id = ?", (member_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No WhatsApp number linked to this team member")
    db.execute(
        "UPDATE whatsapp_contacts SET team_member_id = NULL WHERE id = ?", (row["id"],)
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Public notification subscriptions
# --------------------------------------------------------------------------- #
@router.post(
    "/public/notification-subscriptions",
    response_model=NotificationSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Opt a WhatsApp number in to new-event alerts",
)
def create_subscription(
    payload: NotificationSubscriptionCreate, db: Connection
) -> NotificationSubscriptionOut:
    contact = get_or_create_contact(db, payload.phone_number)
    if payload.display_name and not contact["display_name"]:
        db.execute(
            "UPDATE whatsapp_contacts SET display_name = ? WHERE id = ?",
            (payload.display_name, contact["id"]),
        )
    db.execute(
        "UPDATE whatsapp_contacts SET notify_new_events = 1 WHERE id = ?", (contact["id"],)
    )
    db.commit()
    row = db.execute(
        "SELECT * FROM whatsapp_contacts WHERE id = ?", (contact["id"],)
    ).fetchone()
    return NotificationSubscriptionOut(
        id=row["id"],
        phone_number=row["phone_number"],
        notify_new_events=bool(row["notify_new_events"]),
    )


@router.delete(
    "/public/notification-subscriptions/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Opt a WhatsApp number out of new-event alerts",
)
def delete_subscription(subscription_id: int, db: Connection) -> Response:
    row = db.execute(
        "SELECT id FROM whatsapp_contacts WHERE id = ?", (subscription_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.execute(
        "UPDATE whatsapp_contacts SET notify_new_events = 0 WHERE id = ?", (subscription_id,)
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
