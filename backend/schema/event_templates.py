"""Event-template request and response schemas."""

from pydantic import BaseModel, Field

from backend.schema.common import NonEmptyText, TaskCategory


class TemplateCreate(BaseModel):
    name: NonEmptyText
    description: str = ""
    beneficiary_id: int | None = None


class TemplateOut(BaseModel):
    id: int
    name: str
    description: str
    is_built_in: bool
    beneficiary_id: int | None
    created_at: str
    updated_at: str


class TemplateUpdate(BaseModel):
    name: NonEmptyText | None = None
    description: str | None = None
    beneficiary_id: int | None = None


class TemplateClone(BaseModel):
    name: NonEmptyText | None = None


class TemplateTaskCreate(BaseModel):
    name: NonEmptyText
    body: str = ""
    relative_due_days: int
    category: TaskCategory
    position: int | None = None


class TemplateTaskOut(BaseModel):
    id: int
    event_template_id: int
    name: str
    body: str
    relative_due_days: int
    category: TaskCategory
    position: int


class TemplateTaskUpdate(BaseModel):
    name: NonEmptyText | None = None
    body: str | None = None
    relative_due_days: int | None = None
    category: TaskCategory | None = None
    position: int | None = None


class TaskOrder(BaseModel):
    task_ids: list[int] = Field(min_length=1)


class TemplateSubtaskCreate(BaseModel):
    title: NonEmptyText
    position: int | None = None


class TemplateSubtaskOut(BaseModel):
    id: int
    template_task_id: int
    title: str
    position: int


class TemplateSubtaskUpdate(BaseModel):
    title: NonEmptyText | None = None
    position: int | None = None


class SubtaskOrder(BaseModel):
    subtask_ids: list[int] = Field(min_length=1)


class TemplateTaskDetail(TemplateTaskOut):
    subtasks: list[TemplateSubtaskOut]


class TemplateRoleOut(BaseModel):
    id: int
    name: str
    category: str
    is_required: bool


class TemplateDetail(TemplateOut):
    tasks: list[TemplateTaskDetail]
    roles: list[TemplateRoleOut]
