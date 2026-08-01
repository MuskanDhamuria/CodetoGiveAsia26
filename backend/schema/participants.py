"""Participant and event-participation request and response schemas."""

from pydantic import BaseModel

from backend.schema.common import NonEmptyText


class ParticipantCreate(BaseModel):
    name: NonEmptyText
    contact_number: str | None = None
    email: str | None = None


class ParticipantUpdate(BaseModel):
    name: NonEmptyText | None = None
    contact_number: str | None = None
    email: str | None = None


class ParticipantOut(BaseModel):
    id: int
    name: str
    contact_number: str | None
    email: str | None
    created_at: str
    updated_at: str


class ParticipationCreate(BaseModel):
    participant_id: int
    rsvp_status: bool = False


class ParticipationUpdate(BaseModel):
    rsvp_status: bool | None = None
    attendance: bool | None = None


class ParticipationOut(BaseModel):
    participant_id: int
    name: str
    contact_number: str | None
    email: str | None
    rsvp_status: bool
    attendance: bool | None
