"""Beneficiary group request and response schemas.

An open-ended lookup (same shape as roles/skills) so organisers can add new
beneficiary groups later without a schema change.
"""

from pydantic import BaseModel

from backend.schema.common import NonEmptyText


class BeneficiaryCreate(BaseModel):
    name: NonEmptyText


class BeneficiaryUpdate(BaseModel):
    name: NonEmptyText | None = None


class BeneficiaryOut(BaseModel):
    id: int
    name: str
