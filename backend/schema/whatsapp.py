"""Request/response schemas for the WhatsApp bot, announcements, and certificates."""

from typing import Literal

from pydantic import BaseModel

from backend.schema.common import NonEmptyText


Audience = Literal["all", "participants", "volunteers"]


class AnnouncementCreate(BaseModel):
    title: NonEmptyText
    body: NonEmptyText
    audience: Audience = "all"
    created_by_team_member_id: int | None = None


class AnnouncementOut(BaseModel):
    id: int
    event_id: int | None
    title: str
    body: str
    audience: Audience
    kind: Literal["announcement", "reminder"]
    created_by_team_member_id: int | None
    created_at: str
    sent_at: str | None
    delivered_count: int
    failed_count: int


class ReminderCreate(BaseModel):
    body: NonEmptyText | None = None
    created_by_team_member_id: int | None = None


class CertificateOut(BaseModel):
    id: int
    event_id: int
    participant_id: int | None
    volunteer_id: int | None
    download_token: str
    issued_at: str
    delivered_at: str | None
    link: str


class CertificateCandidateOut(BaseModel):
    """Someone registered for an event, for the manual certificate picker.

    Deliberately not filtered by attendance — the admin panel shows
    ``attended`` as a hint (and can pre-check attendees as a starting point),
    but any registrant can be picked regardless of whether they were marked
    present. See POST /events/{event_id}/certificates/send.
    """

    type: Literal["participant", "volunteer"]
    id: int
    name: str
    attended: bool
    already_issued: bool
    already_delivered: bool


class CertificateRecipient(BaseModel):
    type: Literal["participant", "volunteer"]
    id: int


class CertificateSendIn(BaseModel):
    recipients: list[CertificateRecipient]


class NotificationSubscriptionCreate(BaseModel):
    phone_number: NonEmptyText
    display_name: str | None = None


class NotificationSubscriptionOut(BaseModel):
    id: int
    phone_number: str
    notify_new_events: bool


class TeamMemberWhatsAppLinkCreate(BaseModel):
    phone_number: NonEmptyText


class TeamMemberWhatsAppLinkOut(BaseModel):
    whatsapp_contact_id: int
    team_member_id: int
    phone_number: str
