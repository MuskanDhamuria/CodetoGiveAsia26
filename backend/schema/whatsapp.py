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
