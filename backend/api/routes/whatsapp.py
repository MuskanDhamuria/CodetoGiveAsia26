"""WhatsApp bot webhook, organizer announcements/reminders, and certificates.

Implements the "Announcements, reminders, and bots" and "Certificates"
sections proposed in `backend/API_ENDPOINTS.md`, using the Meta WhatsApp
Cloud API (see `backend/integrations/whatsapp_client.py`).
"""

from __future__ import annotations

import base64
import logging
import sqlite3
from datetime import date
from functools import lru_cache
from pathlib import Path
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
    CertificateOut,
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


LOGO_PATH = Path(__file__).resolve().parents[3] / "public" / "pts-logo.png"


@lru_cache(maxsize=1)
def _logo_data_uri() -> str | None:
    """Base64-embed the PTS logo so the page has no dependency on the frontend
    server being up — the whole certificate must be self-contained."""

    try:
        return "data:image/png;base64," + base64.b64encode(LOGO_PATH.read_bytes()).decode("ascii")
    except OSError:
        return None


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
        """
        SELECT e.name, e.event_date, e.start_time, e.end_time, b.name AS beneficiary_name
        FROM events e
        LEFT JOIN beneficiaries b ON b.id = e.beneficiary_id
        WHERE e.id = ?
        """,
        (certificate["event_id"],),
    ).fetchone()

    is_volunteer = certificate["volunteer_id"] is not None
    if certificate["participant_id"] is not None:
        person = db.execute(
            "SELECT name FROM participants WHERE id = ?", (certificate["participant_id"],)
        ).fetchone()
    else:
        person = db.execute(
            "SELECT name FROM volunteers WHERE id = ?", (certificate["volunteer_id"],)
        ).fetchone()
    person_name = person["name"] if person else "Participant"

    logo_uri = _logo_data_uri()
    logo_img = f'<img src="{logo_uri}" alt="Passion To Serve" class="logo" />' if logo_uri else ""

    if is_volunteer:
        beneficiary_line = (
            f'<p class="beneficiary">in support of <span>{event["beneficiary_name"]}</span></p>'
            if event["beneficiary_name"]
            else ""
        )
        body_html = f"""
                <p class="lede">in grateful recognition of dedicated volunteer service rendered during</p>
                <div class="event-name">{event['name']}</div>
                <div class="event-rule"></div>
                {beneficiary_line}
                <p class="lede on-date">on <span>{event['event_date']}</span></p>
        """
        title = "Certificate of Volunteer Participation"
    else:
        body_html = f"""
                <p class="lede">in recognition of successful completion of</p>
                <div class="event-name">{event['name']}</div>
                <div class="event-rule"></div>
                <p class="lede on-date">on <span>{event['event_date']}</span></p>
        """
        title = "Certificate of Completion"

    issue_date = date.today().isoformat()

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <title>{title}</title>
        <style>
            body {{
                background: #f2efe8; color: #1b3b36; font-family: Georgia, 'Times New Roman', serif;
                margin: 0; padding: 40px 16px;
            }}
            .frame {{
                max-width: 860px; margin: 0 auto; padding: 6px;
                border: 1px solid #1b8a7a; box-shadow: 0 0 0 1px #f2efe8;
            }}
            .frame-inner {{
                border: 1px solid #c99a3f; padding: 48px 56px; background: #f9f7f1;
            }}
            header {{ display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }}
            header .logo {{ width: 64px; height: 64px; object-fit: contain; }}
            header .wordmark {{ letter-spacing: 0.14em; font-size: 20px; font-weight: 700; color: #1b8a7a; }}
            header .subwordmark {{ color: #6b6b62; font-size: 13px; margin-top: 2px; }}
            h1 {{
                font-size: 36px; color: #1b3b36; text-align: center; margin: 24px 0 12px;
                line-height: 1.25;
            }}
            .divider {{ width: 90px; height: 2px; background: #c99a3f; margin: 0 auto 32px; }}
            .lede {{ text-align: center; font-size: 17px; margin: 8px 0; }}
            .name {{
                text-align: center; font-size: 30px; font-weight: 700; margin: 12px 0 6px;
                color: #1b3b36;
            }}
            .name-rule {{ width: 320px; height: 2px; background: #1b8a7a; margin: 0 auto 20px; }}
            .event-name {{ text-align: center; font-size: 22px; font-weight: 700; margin: 6px 0 4px; }}
            .event-rule {{ width: 220px; height: 2px; background: #1b8a7a; margin: 0 auto 16px; }}
            .beneficiary {{ text-align: center; color: #6b6b62; font-size: 14px; margin: 0 0 32px; }}
            .beneficiary span {{ border-bottom: 1px solid #b9b9ac; padding-bottom: 1px; }}
            .on-date {{ color: #6b6b62; font-size: 14px; margin-bottom: 32px; }}
            .on-date span {{ border-bottom: 1px solid #b9b9ac; padding-bottom: 1px; }}
            .signatures {{
                display: flex; justify-content: space-between; margin-top: 72px; gap: 40px;
            }}
            .signature {{ flex: 1; text-align: center; }}
            .signature .signed {{
                font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; font-weight: 700;
                color: #1b3b36; margin-bottom: 6px;
            }}
            .signature .rule {{ border-top: 1px solid #4a4a42; margin-bottom: 6px; }}
            .signature .label {{
                font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #4a4a42;
            }}
        </style>
    </head>
    <body>
        <div class="frame">
            <div class="frame-inner">
                <header>
                    {logo_img}
                    <div>
                        <div class="wordmark">PASSION TO SERVE</div>
                        <div class="subwordmark">Volunteer Network</div>
                    </div>
                </header>
                <h1>{title}</h1>
                <div class="divider"></div>
                <p class="lede">This certificate is proudly presented to</p>
                <div class="name">{person_name}</div>
                <div class="name-rule"></div>
                {body_html}
                <div class="signatures">
                    <div class="signature">
                        <div class="signed">{issue_date}</div>
                        <div class="rule"></div>
                        <div class="label">Date of Issue</div>
                    </div>
                    <div class="signature">
                        <div class="signed">Passion to Serve</div>
                        <div class="rule"></div>
                        <div class="label">Organisation Stamp</div>
                    </div>
                </div>
            </div>
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
