"""Inventory catalogue, stock and movement contracts."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


Quantity = float
ItemType = Literal["consumable", "reusable"]
LotCondition = Literal["pending_sort", "usable", "damaged", "expired", "discarded"]


class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=1)
    sku: str | None = None
    description: str = ""
    unit: str = Field(min_length=1)
    item_type: ItemType
    reorder_level: Quantity = Field(default=0, ge=0)
    is_active: bool = True


class InventoryItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    sku: str | None = None
    description: str | None = None
    reorder_level: Quantity | None = Field(default=None, ge=0)
    is_active: bool | None = None


class InventoryLocationCreate(BaseModel):
    name: str = Field(min_length=1)
    address: str = ""
    event_id: int | None = None
    venue_space_id: int | None = None
    is_temporary: bool = False
    is_active: bool = True


class InventoryLocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    address: str | None = None
    event_id: int | None = None
    venue_space_id: int | None = None
    is_temporary: bool | None = None
    is_active: bool | None = None


class StockAdjustment(BaseModel):
    item_id: int
    location_id: int
    quantity_delta: Quantity
    reason: str = Field(min_length=1)
    expiry_date: date | None = None
    condition: LotCondition = "usable"


class StockTransfer(BaseModel):
    item_id: int
    source_location_id: int
    destination_location_id: int
    quantity: Quantity = Field(gt=0)
    reason: str = Field(min_length=1)

