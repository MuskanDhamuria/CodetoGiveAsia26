"""Volunteer account registration, login, and dashboard schemas."""

from pydantic import BaseModel, Field

from backend.schema.common import NonEmptyText


class VolunteerRegister(BaseModel):
    name: NonEmptyText
    contact_number: NonEmptyText
    password: str = Field(min_length=8)


class VolunteerLogin(BaseModel):
    contact_number: NonEmptyText
    password: str = Field(min_length=1)


class VolunteerAccountOut(BaseModel):
    id: int
    volunteer_id: int
    name: str
    contact_number: str | None
    email: str | None
    phone_verified: bool


class VolunteerAuthResult(BaseModel):
    access_token: str
    volunteer: VolunteerAccountOut


class VolunteerVerifyOtp(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class VolunteerOtpResult(BaseModel):
    phone_verified: bool


class VolunteerDashboardEvent(BaseModel):
    signup_id: int
    event_id: int
    event_name: str
    venue: str
    event_date: str
    event_status: str
    signup_status: str
    assigned_role_name: str | None
    attendance: bool | None


class VolunteerDashboardOut(BaseModel):
    volunteer: VolunteerAccountOut
    active_events: list[VolunteerDashboardEvent]
    past_events: list[VolunteerDashboardEvent]
    has_approved_event: bool
