"""Organization-wide inventory catalogue and immutable stock ledger."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.schema.inventory import (
    InventoryItemCreate,
    InventoryItemUpdate,
    InventoryLocationCreate,
    InventoryLocationUpdate,
    StockAdjustment,
    StockTransfer,
)

router = APIRouter(tags=["inventory"])


def q(value: float) -> float:
    return round(float(value), 3)


def require_row(db, table: str, row_id: int, label: str):
    row = db.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"{label} {row_id} was not found")
    return row


def item_out(row) -> dict:
    result = dict(row)
    result["is_active"] = bool(result["is_active"])
    return result


def location_out(row) -> dict:
    result = dict(row)
    result["is_temporary"] = bool(result["is_temporary"])
    result["is_active"] = bool(result["is_active"])
    return result


def usable_on_hand(db, item_id: int, location_id: int) -> float:
    return q(db.execute(
        """
        SELECT COALESCE(SUM(current_quantity), 0)
        FROM inventory_lots
        WHERE item_id = ? AND location_id = ? AND condition = 'usable'
          AND (expiry_date IS NULL OR date(expiry_date) >= date('now'))
        """,
        (item_id, location_id),
    ).fetchone()[0])


def active_reserved(db, item_id: int, location_id: int) -> float:
    return q(db.execute(
        """
        SELECT COALESCE(SUM(MAX(reserved_quantity - issued_quantity, 0)), 0)
        FROM inventory_allocations
        WHERE item_id = ? AND source_location_id = ?
          AND status IN ('reserved', 'issued')
        """,
        (item_id, location_id),
    ).fetchone()[0])


def available_stock(db, item_id: int, location_id: int) -> float:
    return q(usable_on_hand(db, item_id, location_id) - active_reserved(db, item_id, location_id))


def deduct_usable_lots(db, item_id: int, location_id: int, quantity: float) -> None:
    remaining = q(quantity)
    lots = db.execute(
        """
        SELECT * FROM inventory_lots
        WHERE item_id = ? AND location_id = ? AND condition = 'usable'
          AND current_quantity > 0
          AND (expiry_date IS NULL OR date(expiry_date) >= date('now'))
        ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, id
        """,
        (item_id, location_id),
    ).fetchall()
    for lot in lots:
        if remaining <= 0:
            break
        used = min(remaining, float(lot["current_quantity"]))
        db.execute(
            "UPDATE inventory_lots SET current_quantity = ? WHERE id = ?",
            (q(float(lot["current_quantity"]) - used), lot["id"]),
        )
        remaining = q(remaining - used)
    if remaining > 0:
        raise HTTPException(409, "Insufficient available stock")


@router.post("/inventory/items", status_code=201)
def create_item(payload: InventoryItemCreate, db: Connection) -> dict:
    try:
        row = db.execute(
            """
            INSERT INTO inventory_items
                (name, sku, description, unit, item_type, reorder_level, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
            """,
            (payload.name.strip(), payload.sku, payload.description, payload.unit.strip(),
             payload.item_type, q(payload.reorder_level), int(payload.is_active)),
        ).fetchone()
        db.commit()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "An inventory item with that SKU already exists") from exc
    return item_out(row)


@router.get("/inventory/items")
def list_items(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM inventory_items").fetchone()[0]
    rows = db.execute(
        "SELECT * FROM inventory_items ORDER BY name LIMIT ? OFFSET ?",
        (pagination.limit, pagination.offset),
    ).fetchall()
    return list_envelope([item_out(row) for row in rows], total, pagination)


@router.get("/inventory/items/{item_id}")
def get_item(item_id: int, db: Connection) -> dict:
    return item_out(require_row(db, "inventory_items", item_id, "Inventory item"))


@router.patch("/inventory/items/{item_id}")
def update_item(item_id: int, payload: InventoryItemUpdate, db: Connection) -> dict:
    require_row(db, "inventory_items", item_id, "Inventory item")
    values = payload.model_dump(exclude_unset=True)
    if "is_active" in values:
        values["is_active"] = int(values["is_active"])
    if values:
        db.execute(
            f"UPDATE inventory_items SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
            [*values.values(), item_id],
        )
        db.commit()
    return get_item(item_id, db)


@router.delete("/inventory/items/{item_id}", status_code=204)
def deactivate_item(item_id: int, db: Connection) -> Response:
    if db.execute("UPDATE inventory_items SET is_active = 0 WHERE id = ?", (item_id,)).rowcount == 0:
        raise HTTPException(404, f"Inventory item {item_id} was not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/inventory/locations", status_code=201)
def create_location(payload: InventoryLocationCreate, db: Connection) -> dict:
    row = db.execute(
        """
        INSERT INTO inventory_locations
            (name, address, event_id, venue_space_id, is_temporary, is_active)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING *
        """,
        (payload.name.strip(), payload.address, payload.event_id, payload.venue_space_id,
         int(payload.is_temporary), int(payload.is_active)),
    ).fetchone()
    db.commit()
    return location_out(row)


@router.get("/inventory/locations")
def list_locations(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM inventory_locations").fetchone()[0]
    rows = db.execute(
        "SELECT * FROM inventory_locations ORDER BY name LIMIT ? OFFSET ?",
        (pagination.limit, pagination.offset),
    ).fetchall()
    return list_envelope([location_out(row) for row in rows], total, pagination)


@router.patch("/inventory/locations/{location_id}")
def update_location(location_id: int, payload: InventoryLocationUpdate, db: Connection) -> dict:
    require_row(db, "inventory_locations", location_id, "Inventory location")
    values = payload.model_dump(exclude_unset=True)
    for field in ("is_temporary", "is_active"):
        if field in values:
            values[field] = int(values[field])
    if values:
        db.execute(
            f"UPDATE inventory_locations SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
            [*values.values(), location_id],
        )
        db.commit()
    return location_out(require_row(db, "inventory_locations", location_id, "Inventory location"))


@router.get("/inventory/locations/{location_id}")
def get_location(location_id: int, db: Connection) -> dict:
    result = location_out(require_row(db, "inventory_locations", location_id, "Inventory location"))
    result["stock"] = [
        row for row in list_stock(db)["items"] if row["location_id"] == location_id
    ]
    return result


@router.delete("/inventory/locations/{location_id}", status_code=204)
def deactivate_location(location_id: int, db: Connection) -> Response:
    if db.execute(
        "UPDATE inventory_locations SET is_active = 0 WHERE id = ?", (location_id,)
    ).rowcount == 0:
        raise HTTPException(404, f"Inventory location {location_id} was not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/inventory/stock")
def list_stock(db: Connection) -> dict:
    rows = db.execute(
        """
        SELECT inventory_items.id AS item_id, inventory_items.name AS item_name,
               inventory_items.sku, inventory_items.item_type, inventory_items.unit,
               inventory_items.reorder_level, inventory_locations.id AS location_id,
               inventory_locations.name AS location_name,
               ROUND(SUM(inventory_lots.current_quantity), 3) AS on_hand,
               ROUND(SUM(CASE WHEN inventory_lots.expiry_date IS NOT NULL
                   AND date(inventory_lots.expiry_date) <= date('now', '+30 days')
                   THEN inventory_lots.current_quantity ELSE 0 END), 3) AS expiring
        FROM inventory_lots
        JOIN inventory_items ON inventory_items.id = inventory_lots.item_id
        JOIN inventory_locations ON inventory_locations.id = inventory_lots.location_id
        WHERE inventory_lots.condition = 'usable' AND inventory_lots.current_quantity > 0
          AND (inventory_lots.expiry_date IS NULL OR date(inventory_lots.expiry_date) >= date('now'))
        GROUP BY inventory_items.id, inventory_locations.id
        ORDER BY inventory_items.name, inventory_locations.name
        """
    ).fetchall()
    items = []
    for row in rows:
        result = dict(row)
        result["on_hand"] = q(result["on_hand"])
        result["reserved"] = active_reserved(db, row["item_id"], row["location_id"])
        result["available"] = q(result["on_hand"] - result["reserved"])
        result["expiring"] = q(result["expiring"])
        result["reorder_status"] = result["available"] <= float(result["reorder_level"])
        items.append(result)
    return {"items": items, "total": len(items)}


@router.get("/inventory/movements")
def list_movements(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM stock_movements").fetchone()[0]
    rows = db.execute(
        """
        SELECT stock_movements.*, inventory_items.name AS item_name,
               inventory_locations.name AS location_name
        FROM stock_movements
        JOIN inventory_items ON inventory_items.id = stock_movements.item_id
        JOIN inventory_locations ON inventory_locations.id = stock_movements.location_id
        ORDER BY stock_movements.id DESC LIMIT ? OFFSET ?
        """,
        (pagination.limit, pagination.offset),
    ).fetchall()
    return list_envelope([dict(row) for row in rows], total, pagination)


@router.post("/inventory/adjustments", status_code=201)
def adjust_stock(payload: StockAdjustment, db: Connection) -> dict:
    require_row(db, "inventory_items", payload.item_id, "Inventory item")
    require_row(db, "inventory_locations", payload.location_id, "Inventory location")
    delta = q(payload.quantity_delta)
    if delta == 0:
        raise HTTPException(422, "Adjustment quantity cannot be zero")
    with db:
        if delta > 0:
            lot = db.execute(
                """
                INSERT INTO inventory_lots
                    (item_id, location_id, source_type, expiry_date, condition, current_quantity)
                VALUES (?, ?, 'adjustment', ?, ?, ?) RETURNING id
                """,
                (payload.item_id, payload.location_id,
                 payload.expiry_date.isoformat() if payload.expiry_date else None,
                 payload.condition, delta),
            ).fetchone()
            lot_id = lot["id"]
        else:
            if available_stock(db, payload.item_id, payload.location_id) < abs(delta):
                raise HTTPException(409, "Adjustment would make available stock negative")
            deduct_usable_lots(db, payload.item_id, payload.location_id, abs(delta))
            lot_id = None
        movement = db.execute(
            """
            INSERT INTO stock_movements
                (item_id, lot_id, location_id, movement_type, quantity_delta, reason)
            VALUES (?, ?, ?, 'adjustment', ?, ?) RETURNING *
            """,
            (payload.item_id, lot_id, payload.location_id, delta, payload.reason.strip()),
        ).fetchone()
    return dict(movement)


@router.post("/inventory/transfers", status_code=201)
def transfer_stock(payload: StockTransfer, db: Connection) -> dict:
    if payload.source_location_id == payload.destination_location_id:
        raise HTTPException(422, "Source and destination must differ")
    require_row(db, "inventory_items", payload.item_id, "Inventory item")
    require_row(db, "inventory_locations", payload.source_location_id, "Inventory location")
    require_row(db, "inventory_locations", payload.destination_location_id, "Inventory location")
    quantity = q(payload.quantity)
    if available_stock(db, payload.item_id, payload.source_location_id) < quantity:
        raise HTTPException(409, "Insufficient available stock")
    reference = str(uuid.uuid4())
    with db:
        deduct_usable_lots(db, payload.item_id, payload.source_location_id, quantity)
        destination_lot = db.execute(
            """
            INSERT INTO inventory_lots
                (item_id, location_id, source_type, condition, current_quantity)
            VALUES (?, ?, 'transfer', 'usable', ?) RETURNING id
            """,
            (payload.item_id, payload.destination_location_id, quantity),
        ).fetchone()
        outgoing = db.execute(
            """
            INSERT INTO stock_movements
                (item_id, location_id, destination_location_id, movement_type,
                 quantity_delta, reason, group_reference)
            VALUES (?, ?, ?, 'transfer_out', ?, ?, ?) RETURNING id
            """,
            (payload.item_id, payload.source_location_id, payload.destination_location_id,
             -quantity, payload.reason.strip(), reference),
        ).fetchone()
        incoming = db.execute(
            """
            INSERT INTO stock_movements
                (item_id, lot_id, location_id, movement_type, quantity_delta, reason, group_reference)
            VALUES (?, ?, ?, 'transfer_in', ?, ?, ?) RETURNING id
            """,
            (payload.item_id, destination_lot["id"], payload.destination_location_id,
             quantity, payload.reason.strip(), reference),
        ).fetchone()
    return {"group_reference": reference, "outgoing_movement_id": outgoing["id"],
            "incoming_movement_id": incoming["id"], "quantity": quantity}
