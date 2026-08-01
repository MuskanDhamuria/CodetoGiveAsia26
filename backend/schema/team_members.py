"""Internal team-member request and response schemas."""

from pydantic import BaseModel

from backend.schema.common import NonEmptyText


class TeamMemberCreate(BaseModel):
    name: NonEmptyText
    email: NonEmptyText
    is_active: bool = True


class TeamMemberUpdate(BaseModel):
    name: NonEmptyText | None = None
    email: NonEmptyText | None = None
    is_active: bool | None = None


class TeamMemberOut(BaseModel):
    id: int
    name: str
    email: str
    is_active: bool
    created_at: str
    updated_at: str
