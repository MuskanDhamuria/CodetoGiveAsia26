"""Event logistics planning, allocation and reconciliation contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


RequirementType = Literal["goods", "service"]
Priority = Literal["low", "normal", "high", "critical"]


class RequirementBase(BaseModel):
    requirement_type: RequirementType
    inventory_item_id: int | None = None
    service_name: str | None = None
    base_quantity: float = Field(default=0, ge=0)
    quantity_per_person: float = Field(default=0, ge=0)
    buffer_percentage: float = Field(default=0, ge=0)
    unit: str = Field(min_length=1)
    priority: Priority = "normal"
    notes: str = ""

    @model_validator(mode="after")
    def validate_kind(self):
        if self.requirement_type == "goods" and self.inventory_item_id is None:
            raise ValueError("Goods requirements require an inventory item")
        if self.requirement_type == "service" and not (self.service_name or "").strip():
            raise ValueError("Service requirements require a service name")
        if self.requirement_type == "service" and self.inventory_item_id is not None:
            raise ValueError("Services cannot reference inventory")
        return self


class TemplateRequirementCreate(RequirementBase):
    relative_needed_day: int = 0


class TemplateRequirementUpdate(BaseModel):
    base_quantity: float | None = Field(default=None, ge=0)
    quantity_per_person: float | None = Field(default=None, ge=0)
    buffer_percentage: float | None = Field(default=None, ge=0)
    relative_needed_day: int | None = None
    priority: Priority | None = None
    notes: str | None = None


class EventRequirementCreate(RequirementBase):
    required_quantity: float = Field(ge=0)
    needed_by: datetime


class EventRequirementUpdate(BaseModel):
    required_quantity: float | None = Field(default=None, ge=0)
    needed_by: datetime | None = None
    priority: Priority | None = None
    notes: str | None = None
    is_cancelled: bool | None = None


class ReserveAllocation(BaseModel):
    location_id: int
    quantity: float = Field(gt=0)


class AllocationQuantity(BaseModel):
    quantity: float = Field(gt=0)


class AllocationReconcile(BaseModel):
    returned_quantity: float = Field(default=0, ge=0)
    consumed_quantity: float = Field(default=0, ge=0)
    damaged_quantity: float = Field(default=0, ge=0)
    lost_quantity: float = Field(default=0, ge=0)
    distributed_quantity: float = Field(default=0, ge=0)
    notes: str = ""


class ReconciliationFinalize(BaseModel):
    notes: str = ""
