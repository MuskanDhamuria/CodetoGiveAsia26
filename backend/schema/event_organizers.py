"""Event-specific organizer and task-assignee schemas."""

from typing import Literal

from pydantic import BaseModel, Field


PersonType = Literal["team_member", "volunteer"]


class EventOrganizerCreate(BaseModel):
    person_type: PersonType
    person_id: int = Field(gt=0)


class EventPersonOption(BaseModel):
    person_type: PersonType
    person_id: int
    name: str
    email: str | None = None


class EventOrganizerOut(EventPersonOption):
    id: int
    event_id: int
    team_member_id: int | None = None
    volunteer_id: int | None = None
    identity_label: Literal["PTS staff", "Volunteer organiser"]


class OrganizerCandidates(BaseModel):
    pts_staff: list[EventPersonOption]
    volunteers: list[EventPersonOption]


class TaskAssigneeGroups(BaseModel):
    organizers: list[EventPersonOption]
    volunteers: list[EventPersonOption]
