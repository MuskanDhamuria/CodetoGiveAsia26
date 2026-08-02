"""Venue booking and donation batch contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.schema.inventory import LotCondition


class VenueCreate(BaseModel):
    name: str = Field(min_length=1)
    address: str = ""
    managing_organization_id: int | None = None
    notes: str = ""
    is_active: bool = True


class VenueUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    address: str | None = None
    managing_organization_id: int | None = None
    notes: str | None = None
    is_active: bool | None = None


class VenueSpaceCreate(BaseModel):
    name: str = Field(min_length=1)
    pax_capacity: int | None = Field(default=None, ge=0)
    accessibility_information: str = ""
    is_active: bool = True


class VenueSpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    pax_capacity: int | None = Field(default=None, ge=0)
    accessibility_information: str | None = None
    is_active: bool | None = None


class VenueBookingCreate(BaseModel):
    venue_space_id: int
    is_primary: bool = False
    status: Literal["tentative", "confirmed", "cancelled", "completed"] = "tentative"
    start_at: datetime
    end_at: datetime
    cost_sgd_cents: int | None = Field(default=None, ge=0)
    contact_id: int | None = None
    notes: str = ""


class VenueBookingUpdate(BaseModel):
    venue_space_id: int | None = None
    is_primary: bool | None = None
    status: Literal["tentative", "confirmed", "cancelled", "completed"] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    cost_sgd_cents: int | None = Field(default=None, ge=0)
    contact_id: int | None = None
    notes: str | None = None


class DonationBatchCreate(BaseModel):
    event_id: int | None = None
    source_organization_id: int | None = None
    collection_at: datetime | None = None
    container_count: float | None = Field(default=None, ge=0)
    container_unit: str | None = None
    notes: str = ""


class DonationSort(BaseModel):
    item_id: int
    location_id: int
    quantity: float = Field(gt=0)
    condition: LotCondition = "usable"
    expiry_date: str | None = None
