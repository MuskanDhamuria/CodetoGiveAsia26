"""Volunteer profile and event volunteer-signup request and response schemas."""

from typing import Literal

from pydantic import BaseModel


class RoleOut(BaseModel):
    id: int
    name: str
    category: str
    is_required: bool


class SkillOut(BaseModel):
    id: int
    name: str


class RoleInterestOut(BaseModel):
    role_id: int
    name: str
    is_lead: bool


class VolunteerCounts(BaseModel):
    events_signed_up: int
    events_approved: int
    events_attended: int


class VolunteerSummary(BaseModel):
    id: int
    name: str
    contact_number: str | None
    email: str | None
    signup_status: str


class VolunteerListItem(VolunteerSummary):
    skills: list[str]
    counts: VolunteerCounts


class VolunteerDetail(VolunteerSummary):
    skills: list[SkillOut]
    interests: list[RoleInterestOut]
    counts: VolunteerCounts


class VolunteerEventHistory(BaseModel):
    signup_id: int
    event_id: int
    event_name: str
    event_date: str
    status: str
    assigned_role_id: int | None
    assigned_role_name: str | None
    is_leader: bool
    attendance: bool | None


class SignupOut(BaseModel):
    id: int
    event_id: int
    volunteer_id: int
    volunteer_name: str
    status: str
    assigned_role_id: int | None
    assigned_role_name: str | None
    is_leader: bool
    attendance: bool | None


class SignupUpdate(BaseModel):
    status: Literal["requested", "approved", "rejected"] | None = None
    assigned_role_id: int | None = None
    is_leader: bool | None = None
    attendance: bool | None = None


class SignupApprove(BaseModel):
    assigned_role_id: int
    is_leader: bool = False


class PublicSignupInput(BaseModel):
    name: str
    contact_number: str
    email: str | None = None
    role_ids: list[int] = []


class PublicSignupResult(BaseModel):
    signup: SignupOut
    volunteer_created: bool
