"""External organization, contacts and procurement contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.schema.inventory import LotCondition


Capability = Literal[
    "supplier", "donor", "transport_provider", "venue_partner", "ngo",
    "government_agency", "dormitory", "education_provider",
]
OrderType = Literal["purchase", "rental", "service"]


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1)
    notes: str = ""
    capabilities: list[Capability] = []
    is_active: bool = True


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    notes: str | None = None
    capabilities: list[Capability] | None = None
    is_active: bool | None = None


class ContactCreate(BaseModel):
    name: str = Field(min_length=1)
    role: str = ""
    email: str | None = None
    phone: str | None = None
    is_primary: bool = False
    is_active: bool = True


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    role: str | None = None
    email: str | None = None
    phone: str | None = None
    is_primary: bool | None = None
    is_active: bool | None = None


class SupplierOrderCreate(BaseModel):
    organization_id: int
    contact_id: int | None = None
    event_id: int | None = None
    order_type: OrderType
    fees_sgd_cents: int | None = Field(default=None, ge=0)
    delivery_start: datetime | None = None
    delivery_end: datetime | None = None
    collection_start: datetime | None = None
    collection_end: datetime | None = None
    destination_location_id: int | None = None
    destination_text: str = ""
    notes: str = ""


class SupplierOrderUpdate(BaseModel):
    contact_id: int | None = None
    event_id: int | None = None
    fees_sgd_cents: int | None = Field(default=None, ge=0)
    delivery_start: datetime | None = None
    delivery_end: datetime | None = None
    collection_start: datetime | None = None
    collection_end: datetime | None = None
    destination_location_id: int | None = None
    destination_text: str | None = None
    notes: str | None = None


class SupplierOrderLineCreate(BaseModel):
    requirement_id: int | None = None
    inventory_item_id: int | None = None
    description: str = Field(min_length=1)
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1)
    unit_cost_sgd_cents: int | None = Field(default=None, ge=0)


class SupplierOrderLineUpdate(BaseModel):
    requirement_id: int | None = None
    inventory_item_id: int | None = None
    description: str | None = Field(default=None, min_length=1)
    quantity: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1)
    unit_cost_sgd_cents: int | None = Field(default=None, ge=0)


class FulfilmentCreate(BaseModel):
    line_id: int | None = None
    quantity: float | None = Field(default=None, gt=0)
    condition: LotCondition = "usable"
    expiry_date: str | None = None
    notes: str = ""
