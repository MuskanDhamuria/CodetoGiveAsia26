"""Event, task, and subtask request and response schemas."""

from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field

from backend.schema.common import (
    EventStatus,
    NonEmptyText,
    TaskCategory,
    TaskStatus,
)


class EventSummary(BaseModel):
    id: int
    name: str
    venue: str
    event_date: str
    description: str
    start_time: str | None = None
    end_time: str | None = None
    status: EventStatus
    beneficiary_id: int | None = None
    expected_attendance: int | None = None
    is_cancelled: bool = False
    # Alias of `start_time` kept for the participant portal, which predates
    # the start_time/end_time split and still reads a single event time.
    event_time: str | None = None


class EventCreate(BaseModel):
    event_template_id: int | None
    name: NonEmptyText
    venue: NonEmptyText
    event_date: date
    description: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    beneficiary_id: int | None = None
    expected_attendance: int | None = Field(default=None, ge=0)


class EventUpdate(BaseModel):
    name: NonEmptyText | None = None
    venue: NonEmptyText | None = None
    event_date: date | None = None
    description: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    status: EventStatus | None = None
    beneficiary_id: int | None = None
    expected_attendance: int | None = Field(default=None, ge=0)


class EventTaskAssigneeInput(BaseModel):
    person_type: Literal["team_member", "volunteer"]
    person_id: int
    is_lead: bool = False


class EventTaskAssigneeOut(EventTaskAssigneeInput):
    name: str
    email: str | None = None


class EventSubtaskTimeLogCreate(BaseModel):
    person_type: Literal["team_member", "volunteer"]
    person_id: int
    minutes_spent: int = Field(gt=0)
    notes: str = ""


class EventSubtaskTimeLogOut(EventSubtaskTimeLogCreate):
    id: int
    name: str
    logged_at: str


class EventSubtaskOut(BaseModel):
    id: int
    title: str
    position: int
    completed: bool
    scheduled_start: str | None = None
    scheduled_end: str | None = None
    estimated_minutes: int | None = None
    assignees: list[EventTaskAssigneeOut] = Field(default_factory=list)
    time_logs: list[EventSubtaskTimeLogOut] = Field(default_factory=list)


class EventTaskOut(BaseModel):
    id: int
    team_member_id: int | None
    volunteer_id: int | None
    template_task_id: int | None
    name: str
    body: str
    due_at: str
    category: TaskCategory
    status: TaskStatus
    position: int
    assignees: list[EventTaskAssigneeOut] = Field(default_factory=list)
    subtasks: list[EventSubtaskOut]


class EventDetail(EventSummary):
    event_template_id: int | None
    created_at: str
    updated_at: str
    tasks: list[EventTaskOut]


class EventReschedule(BaseModel):
    event_date: date
    shift_task_deadlines: bool = True


class EventSubtaskUpdate(BaseModel):
    title: NonEmptyText | None = None
    completed: bool | None = None
    position: int | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    estimated_minutes: int | None = Field(default=None, ge=0)
    assignees: list[EventTaskAssigneeInput] | None = None


class EventSubtaskCreate(BaseModel):
    title: NonEmptyText
    position: int | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    estimated_minutes: int | None = Field(default=None, ge=0)
    assignees: list[EventTaskAssigneeInput] = Field(default_factory=list)


class SubtaskOrder(BaseModel):
    subtask_ids: list[int] = Field(min_length=1)


class EventTaskUpdate(BaseModel):
    name: NonEmptyText | None = None
    body: str | None = None
    due_at: date | datetime | None = None
    category: TaskCategory | None = None
    status: TaskStatus | None = None
    team_member_id: int | None = None
    volunteer_id: int | None = None
    assignees: list[EventTaskAssigneeInput] | None = None
    position: int | None = None


class EventTaskCreate(BaseModel):
    name: NonEmptyText
    body: str = ""
    due_at: date | datetime
    category: TaskCategory
    status: TaskStatus = "incomplete"
    team_member_id: int | None = None
    volunteer_id: int | None = None
    assignees: list[EventTaskAssigneeInput] = Field(default_factory=list)
    position: int | None = None


class TaskOrder(BaseModel):
    task_ids: list[int] = Field(min_length=1)
