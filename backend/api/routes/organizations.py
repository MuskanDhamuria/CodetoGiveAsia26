"""External organizations, reusable contacts and supplier orders."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.api.routes.inventory import q, require_row
from backend.schema.organizations import (
    ContactCreate,
    ContactUpdate,
    FulfilmentCreate,
    OrganizationCreate,
    OrganizationUpdate,
    SupplierOrderCreate,
    SupplierOrderLineCreate,
    SupplierOrderLineUpdate,
    SupplierOrderUpdate,
)

router = APIRouter(tags=["external organizations and supplier orders"])


def organization_out(db, organization_id: int) -> dict:
    row = require_row(db, "external_organizations", organization_id, "External organization")
    result = dict(row)
    result["is_active"] = bool(result["is_active"])
    result["capabilities"] = [
        item["capability"] for item in db.execute(
            "SELECT capability FROM organization_capabilities WHERE organization_id = ? ORDER BY capability",
            (organization_id,),
        ).fetchall()
    ]
    result["contacts"] = [contact_out(item) for item in db.execute(
        "SELECT * FROM organization_contacts WHERE organization_id = ? ORDER BY is_primary DESC, name",
        (organization_id,),
    ).fetchall()]
    result["event_count"] = db.execute(
        "SELECT COUNT(*) FROM event_organizations WHERE organization_id = ?", (organization_id,)
    ).fetchone()[0]
    result["order_count"] = db.execute(
        "SELECT COUNT(*) FROM supplier_orders WHERE organization_id = ?", (organization_id,)
    ).fetchone()[0]
    return result


def contact_out(row) -> dict:
    result = dict(row)
    result["is_primary"] = bool(result["is_primary"])
    result["is_active"] = bool(result["is_active"])
    return result


def order_out(db, order_id: int) -> dict:
    row = db.execute(
        """
        SELECT supplier_orders.*, external_organizations.name AS organization_name,
               organization_contacts.name AS contact_name,
               inventory_locations.name AS destination_location_name
        FROM supplier_orders
        JOIN external_organizations ON external_organizations.id = supplier_orders.organization_id
        LEFT JOIN organization_contacts ON organization_contacts.id = supplier_orders.contact_id
        LEFT JOIN inventory_locations ON inventory_locations.id = supplier_orders.destination_location_id
        WHERE supplier_orders.id = ?
        """, (order_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Supplier order {order_id} was not found")
    result = dict(row)
    result["lines"] = [dict(line) for line in db.execute(
        "SELECT * FROM supplier_order_lines WHERE supplier_order_id = ? ORDER BY id", (order_id,)
    ).fetchall()]
    result["fulfilments"] = [dict(record) for record in db.execute(
        "SELECT * FROM supplier_order_fulfilments WHERE supplier_order_id = ? ORDER BY id",
        (order_id,),
    ).fetchall()]
    return result


def ensure_order_event_editable(db, order: dict) -> None:
    if order["event_id"] is None:
        return
    event = require_row(db, "events", order["event_id"], "Event")
    if event["status"] == "closed":
        raise HTTPException(409, "Supplier Orders for a closed Event are read-only during reconciliation")


def set_capabilities(db, organization_id: int, capabilities: list[str]) -> None:
    db.execute("DELETE FROM organization_capabilities WHERE organization_id = ?", (organization_id,))
    db.executemany(
        "INSERT INTO organization_capabilities (organization_id, capability) VALUES (?, ?)",
        [(organization_id, capability) for capability in dict.fromkeys(capabilities)],
    )


@router.post("/external-organizations", status_code=201)
def create_organization(payload: OrganizationCreate, db: Connection) -> dict:
    try:
        with db:
            row = db.execute(
                "INSERT INTO external_organizations (name, notes, is_active) VALUES (?, ?, ?) RETURNING id",
                (payload.name.strip(), payload.notes, int(payload.is_active)),
            ).fetchone()
            set_capabilities(db, row["id"], payload.capabilities)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "An external organization with that name already exists") from exc
    return organization_out(db, row["id"])


@router.get("/external-organizations")
def list_organizations(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM external_organizations").fetchone()[0]
    ids = db.execute(
        "SELECT id FROM external_organizations ORDER BY name LIMIT ? OFFSET ?",
        (pagination.limit, pagination.offset),
    ).fetchall()
    return list_envelope([organization_out(db, row["id"]) for row in ids], total, pagination)


@router.get("/external-organizations/{organization_id}")
def get_organization(organization_id: int, db: Connection) -> dict:
    result = organization_out(db, organization_id)
    result["events"] = [dict(row) for row in db.execute(
        """SELECT events.id, events.name, events.event_date
           FROM event_organizations JOIN events ON events.id = event_organizations.event_id
           WHERE organization_id = ? ORDER BY events.event_date DESC""", (organization_id,)
    ).fetchall()]
    result["orders"] = [dict(row) for row in db.execute(
        "SELECT id, order_type, status, event_id, delivery_start FROM supplier_orders WHERE organization_id = ? ORDER BY id DESC",
        (organization_id,),
    ).fetchall()]
    return result


@router.patch("/external-organizations/{organization_id}")
def update_organization(organization_id: int, payload: OrganizationUpdate, db: Connection) -> dict:
    require_row(db, "external_organizations", organization_id, "External organization")
    values = payload.model_dump(exclude_unset=True)
    capabilities = values.pop("capabilities", None)
    if "is_active" in values:
        values["is_active"] = int(values["is_active"])
    with db:
        if values:
            db.execute(
                f"UPDATE external_organizations SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
                [*values.values(), organization_id],
            )
        if capabilities is not None:
            set_capabilities(db, organization_id, capabilities)
    return organization_out(db, organization_id)


@router.delete("/external-organizations/{organization_id}", status_code=204)
def deactivate_organization(organization_id: int, db: Connection) -> Response:
    if db.execute(
        "UPDATE external_organizations SET is_active = 0 WHERE id = ?", (organization_id,)
    ).rowcount == 0:
        raise HTTPException(404, f"External organization {organization_id} was not found")
    db.execute(
        "UPDATE organization_contacts SET is_active = 0, is_primary = 0 WHERE organization_id = ?",
        (organization_id,),
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/external-organizations/{organization_id}/contacts", status_code=201)
def create_contact(organization_id: int, payload: ContactCreate, db: Connection) -> dict:
    require_row(db, "external_organizations", organization_id, "External organization")
    with db:
        if payload.is_primary:
            db.execute("UPDATE organization_contacts SET is_primary = 0 WHERE organization_id = ?", (organization_id,))
        row = db.execute(
            """INSERT INTO organization_contacts
               (organization_id, name, role, email, phone, is_primary, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            (organization_id, payload.name.strip(), payload.role, payload.email, payload.phone,
             int(payload.is_primary), int(payload.is_active)),
        ).fetchone()
    return contact_out(row)


@router.patch("/external-organizations/{organization_id}/contacts/{contact_id}")
def update_contact(organization_id: int, contact_id: int, payload: ContactUpdate, db: Connection) -> dict:
    row = db.execute(
        "SELECT * FROM organization_contacts WHERE id = ? AND organization_id = ?",
        (contact_id, organization_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Organization contact {contact_id} was not found")
    values = payload.model_dump(exclude_unset=True)
    for field in ("is_primary", "is_active"):
        if field in values:
            values[field] = int(values[field])
    with db:
        if values.get("is_primary"):
            db.execute("UPDATE organization_contacts SET is_primary = 0 WHERE organization_id = ?", (organization_id,))
        if values:
            db.execute(
                f"UPDATE organization_contacts SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
                [*values.values(), contact_id],
            )
    return contact_out(require_row(db, "organization_contacts", contact_id, "Organization contact"))


@router.delete("/external-organizations/{organization_id}/contacts/{contact_id}", status_code=204)
def deactivate_contact(organization_id: int, contact_id: int, db: Connection) -> Response:
    changed = db.execute(
        "UPDATE organization_contacts SET is_active = 0, is_primary = 0 WHERE id = ? AND organization_id = ?",
        (contact_id, organization_id),
    ).rowcount
    if changed == 0:
        raise HTTPException(404, f"Organization contact {contact_id} was not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/events/{event_id}/external-organizations", status_code=201)
def link_event_organization(event_id: int, organization_id: int, db: Connection) -> dict:
    require_row(db, "events", event_id, "Event")
    require_row(db, "external_organizations", organization_id, "External organization")
    organization = require_row(db, "external_organizations", organization_id, "External organization")
    with db:
        db.execute(
            "INSERT OR IGNORE INTO event_organizations (event_id, organization_id) VALUES (?, ?)",
            (event_id, organization_id),
        )
        # Existing report queries continue reading the legacy name snapshot.
        db.execute(
            "INSERT OR IGNORE INTO event_partners (event_id, name) VALUES (?, ?)",
            (event_id, organization["name"]),
        )
    return organization_out(db, organization_id)


@router.post("/supplier-orders", status_code=201)
def create_order(payload: SupplierOrderCreate, db: Connection) -> dict:
    require_row(db, "external_organizations", payload.organization_id, "External organization")
    if payload.event_id is not None:
        event = require_row(db, "events", payload.event_id, "Event")
        if event["status"] == "closed":
            raise HTTPException(409, "Supplier Orders cannot be created for a closed Event")
    values = payload.model_dump()
    for field in ("delivery_start", "delivery_end", "collection_start", "collection_end"):
        if values[field] is not None:
            values[field] = values[field].isoformat()
    with db:
        row = db.execute(
            """INSERT INTO supplier_orders
           (organization_id, contact_id, event_id, order_type, fees_sgd_cents,
            delivery_start, delivery_end, collection_start, collection_end,
            destination_location_id, destination_text, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
            tuple(values[field] for field in (
            "organization_id", "contact_id", "event_id", "order_type", "fees_sgd_cents",
            "delivery_start", "delivery_end", "collection_start", "collection_end",
            "destination_location_id", "destination_text", "notes",
            )),
        ).fetchone()
        if payload.event_id is not None:
            organization = require_row(db, "external_organizations", payload.organization_id, "External organization")
            db.execute(
                "INSERT OR IGNORE INTO event_organizations (event_id, organization_id) VALUES (?, ?)",
                (payload.event_id, payload.organization_id),
            )
            db.execute(
                "INSERT OR IGNORE INTO event_partners (event_id, name) VALUES (?, ?)",
                (payload.event_id, organization["name"]),
            )
    return order_out(db, row["id"])


@router.get("/supplier-orders")
def list_orders(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM supplier_orders").fetchone()[0]
    ids = db.execute(
        "SELECT id FROM supplier_orders ORDER BY id DESC LIMIT ? OFFSET ?",
        (pagination.limit, pagination.offset),
    ).fetchall()
    return list_envelope([order_out(db, row["id"]) for row in ids], total, pagination)


@router.get("/supplier-orders/{order_id}")
def get_order(order_id: int, db: Connection) -> dict:
    return order_out(db, order_id)


@router.patch("/supplier-orders/{order_id}")
def update_order(order_id: int, payload: SupplierOrderUpdate, db: Connection) -> dict:
    order = order_out(db, order_id)
    ensure_order_event_editable(db, order)
    if order["status"] != "draft":
        raise HTTPException(409, "Only draft orders can be edited")
    values = payload.model_dump(exclude_unset=True)
    for field in ("delivery_start", "delivery_end", "collection_start", "collection_end"):
        if field in values and values[field] is not None:
            values[field] = values[field].isoformat()
    if values:
        db.execute(
            f"UPDATE supplier_orders SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
            [*values.values(), order_id],
        )
        db.commit()
    return order_out(db, order_id)


@router.post("/supplier-orders/{order_id}/lines", status_code=201)
def add_order_line(order_id: int, payload: SupplierOrderLineCreate, db: Connection) -> dict:
    order = order_out(db, order_id)
    ensure_order_event_editable(db, order)
    if order["status"] != "draft":
        raise HTTPException(409, "Lines can only be added to draft orders")
    if order["order_type"] == "purchase" and payload.inventory_item_id is None:
        raise HTTPException(422, "Purchase lines require an inventory item")
    if payload.inventory_item_id is not None:
        item = require_row(db, "inventory_items", payload.inventory_item_id, "Inventory item")
        if item["unit"].lower() != payload.unit.strip().lower():
            raise HTTPException(422, f"Order line unit must match the Inventory Item unit ({item['unit']})")
    if payload.requirement_id is not None:
        requirement = require_row(db, "event_logistics_requirements", payload.requirement_id, "Event logistics requirement")
        if order["event_id"] != requirement["event_id"]:
            raise HTTPException(422, "The Requirement must belong to the Supplier Order's Event")
        if requirement["unit"].lower() != payload.unit.strip().lower():
            raise HTTPException(422, f"Order line unit must match the Requirement unit ({requirement['unit']})")
    row = db.execute(
        """INSERT INTO supplier_order_lines
           (supplier_order_id, requirement_id, inventory_item_id, description,
            quantity, unit, unit_cost_sgd_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *""",
        (order_id, payload.requirement_id, payload.inventory_item_id, payload.description.strip(),
         q(payload.quantity), payload.unit.strip(), payload.unit_cost_sgd_cents),
    ).fetchone()
    db.commit()
    return dict(row)


@router.patch("/supplier-orders/{order_id}/lines/{line_id}")
def update_order_line(order_id: int, line_id: int, payload: SupplierOrderLineUpdate, db: Connection) -> dict:
    order = order_out(db, order_id)
    ensure_order_event_editable(db, order)
    if order["status"] != "draft":
        raise HTTPException(409, "Lines can only be edited on draft orders")
    line = require_order_line(db, order_id, line_id)
    values = payload.model_dump(exclude_unset=True)
    if "quantity" in values:
        values["quantity"] = q(values["quantity"])
    if order["order_type"] == "purchase" and values.get("inventory_item_id", line["inventory_item_id"]) is None:
        raise HTTPException(422, "Purchase lines require an inventory item")
    resulting_item_id = values.get("inventory_item_id", line["inventory_item_id"])
    resulting_unit = values.get("unit", line["unit"])
    if resulting_item_id is not None:
        item = require_row(db, "inventory_items", resulting_item_id, "Inventory item")
        if item["unit"].lower() != resulting_unit.strip().lower():
            raise HTTPException(422, f"Order line unit must match the Inventory Item unit ({item['unit']})")
    if values:
        db.execute(
            f"UPDATE supplier_order_lines SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
            [*values.values(), line_id],
        )
        db.commit()
    return dict(require_order_line(db, order_id, line_id))


@router.delete("/supplier-orders/{order_id}/lines/{line_id}", status_code=204)
def delete_order_line(order_id: int, line_id: int, db: Connection) -> Response:
    order = order_out(db, order_id)
    ensure_order_event_editable(db, order)
    if order["status"] != "draft":
        raise HTTPException(409, "Lines can only be deleted from draft orders")
    if db.execute(
        "DELETE FROM supplier_order_lines WHERE id = ? AND supplier_order_id = ?",
        (line_id, order_id),
    ).rowcount == 0:
        raise HTTPException(404, f"Supplier order line {line_id} was not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def transition_order(db, order_id: int, allowed: tuple[str, ...], target: str) -> dict:
    order = order_out(db, order_id)
    ensure_order_event_editable(db, order)
    if order["status"] not in allowed:
        raise HTTPException(409, f"Order cannot move from {order['status']} to {target}")
    if target == "confirmed" and not order["lines"]:
        raise HTTPException(409, "An order needs at least one line before confirmation")
    db.execute("UPDATE supplier_orders SET status = ? WHERE id = ?", (target, order_id))
    db.commit()
    return order_out(db, order_id)


@router.post("/supplier-orders/{order_id}/confirm")
def confirm_order(order_id: int, db: Connection) -> dict:
    return transition_order(db, order_id, ("draft",), "confirmed")


def require_order_line(db, order_id: int, line_id: int | None):
    if line_id is None:
        raise HTTPException(422, "A line is required")
    row = db.execute(
        "SELECT * FROM supplier_order_lines WHERE id = ? AND supplier_order_id = ?",
        (line_id, order_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Supplier order line {line_id} was not found")
    return row


@router.post("/supplier-orders/{order_id}/receive", status_code=201)
def receive_order(order_id: int, payload: FulfilmentCreate, db: Connection) -> dict:
    order = order_out(db, order_id)
    ensure_order_event_editable(db, order)
    if order["status"] not in ("confirmed", "in_progress"):
        raise HTTPException(409, "Only confirmed or in-progress orders can be received")
    line = require_order_line(db, order_id, payload.line_id)
    quantity = q(payload.quantity or 0)
    received = q(db.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM supplier_order_fulfilments WHERE line_id = ? AND fulfilment_type IN ('receipt', 'delivery')",
        (line["id"],),
    ).fetchone()[0])
    if quantity <= 0 or q(received + quantity) > float(line["quantity"]):
        raise HTTPException(409, "Receipt exceeds the unfulfilled line quantity")
    if order["order_type"] == "purchase" and order["destination_location_id"] is None:
        raise HTTPException(409, "Purchase receipts need an inventory destination")
    with db:
        fulfilment_type = "receipt" if order["order_type"] == "purchase" else "delivery"
        fulfilment = db.execute(
            """INSERT INTO supplier_order_fulfilments
               (supplier_order_id, line_id, fulfilment_type, quantity, notes)
               VALUES (?, ?, ?, ?, ?) RETURNING id""",
            (order_id, line["id"], fulfilment_type, quantity, payload.notes),
        ).fetchone()
        lot_id = None
        if order["order_type"] == "purchase":
            lot = db.execute(
                """INSERT INTO inventory_lots
                   (item_id, location_id, source_type, source_order_fulfilment_id,
                    expiry_date, condition, current_quantity)
                   VALUES (?, ?, 'purchase', ?, ?, ?, ?) RETURNING id""",
                (line["inventory_item_id"], order["destination_location_id"], fulfilment["id"],
                 payload.expiry_date, payload.condition, quantity),
            ).fetchone()
            lot_id = lot["id"]
            db.execute(
                "UPDATE supplier_order_fulfilments SET inventory_lot_id = ? WHERE id = ?",
                (lot_id, fulfilment["id"]),
            )
            db.execute(
                """INSERT INTO stock_movements
                   (item_id, lot_id, location_id, movement_type, quantity_delta, reason)
                   VALUES (?, ?, ?, 'receipt', ?, ?)""",
                (line["inventory_item_id"], lot_id, order["destination_location_id"], quantity,
                 f"Purchase order {order_id} receipt"),
            )
        db.execute(
            "UPDATE supplier_orders SET status = 'in_progress', actual_delivery_at = COALESCE(actual_delivery_at, ?) WHERE id = ?",
            (datetime.now().isoformat(), order_id),
        )
    return dict(db.execute("SELECT * FROM supplier_order_fulfilments WHERE id = ?", (fulfilment["id"],)).fetchone())


@router.post("/supplier-orders/{order_id}/return", status_code=201)
def return_rental(order_id: int, payload: FulfilmentCreate, db: Connection) -> dict:
    order = order_out(db, order_id)
    if order["order_type"] != "rental" or order["status"] not in ("confirmed", "in_progress"):
        raise HTTPException(409, "Only active rental orders can be returned")
    line = require_order_line(db, order_id, payload.line_id)
    delivered = q(db.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM supplier_order_fulfilments WHERE line_id = ? AND fulfilment_type = 'delivery'",
        (line["id"],),
    ).fetchone()[0])
    returned = q(db.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM supplier_order_fulfilments WHERE line_id = ? AND fulfilment_type = 'return'",
        (line["id"],),
    ).fetchone()[0])
    return_quantity = q(payload.quantity or delivered - returned)
    if return_quantity <= 0 or q(returned + return_quantity) > delivered:
        raise HTTPException(409, "Rental return exceeds the delivered quantity")
    row = db.execute(
        """INSERT INTO supplier_order_fulfilments
           (supplier_order_id, line_id, fulfilment_type, quantity, notes)
           VALUES (?, ?, 'return', ?, ?) RETURNING *""",
        (order_id, line["id"], return_quantity, payload.notes),
    ).fetchone()
    db.execute("UPDATE supplier_orders SET actual_collection_at = ? WHERE id = ?", (datetime.now().isoformat(), order_id))
    db.commit()
    return dict(row)


@router.post("/supplier-orders/{order_id}/complete")
def complete_order(order_id: int, payload: FulfilmentCreate, db: Connection) -> dict:
    order = order_out(db, order_id)
    if order["status"] not in ("confirmed", "in_progress"):
        raise HTTPException(409, "Only active orders can be completed")
    with db:
        if order["order_type"] == "service":
            db.execute(
                """INSERT INTO supplier_order_fulfilments
                   (supplier_order_id, line_id, fulfilment_type, quantity, notes)
                   VALUES (?, ?, 'service_completion', ?, ?)""",
                (order_id, payload.line_id, payload.quantity, payload.notes),
            )
        elif order["order_type"] == "rental":
            delivery_and_returns = db.execute(
                """SELECT
                     COALESCE(SUM(CASE WHEN fulfilment_type = 'delivery' THEN quantity ELSE 0 END), 0),
                     COALESCE(SUM(CASE WHEN fulfilment_type = 'return' THEN quantity ELSE 0 END), 0)
                   FROM supplier_order_fulfilments WHERE supplier_order_id = ?""",
                (order_id,),
            ).fetchone()
            if delivery_and_returns[0] <= 0 or q(delivery_and_returns[0]) != q(delivery_and_returns[1]):
                raise HTTPException(409, "All delivered rental quantities must be returned before completion")
        elif order["order_type"] == "purchase":
            ordered = q(sum(float(line["quantity"]) for line in order["lines"]))
            received = q(db.execute(
                "SELECT COALESCE(SUM(quantity), 0) FROM supplier_order_fulfilments WHERE supplier_order_id = ? AND fulfilment_type = 'receipt'",
                (order_id,),
            ).fetchone()[0])
            if received != ordered:
                raise HTTPException(409, "All purchased quantities must be received before completion")
        db.execute("UPDATE supplier_orders SET status = 'completed' WHERE id = ?", (order_id,))
    return order_out(db, order_id)


@router.post("/supplier-orders/{order_id}/cancel")
def cancel_order(order_id: int, db: Connection) -> dict:
    return transition_order(db, order_id, ("draft", "confirmed", "in_progress"), "cancelled")
