"""Template and Event logistics planning, allocation and reconciliation."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.api.routes.inventory import (
    active_reserved,
    available_stock,
    deduct_usable_lots,
    q,
    require_row,
)
from backend.schema.logistics import (
    AllocationQuantity,
    AllocationReconcile,
    EventRequirementCreate,
    EventRequirementUpdate,
    ReconciliationFinalize,
    RequirementBackfill,
    ReserveAllocation,
    TemplateRequirementCreate,
    TemplateRequirementUpdate,
)

router = APIRouter(tags=["event logistics"])


def requirement_name(db, row) -> str:
    if row["requirement_type"] == "service":
        return row["service_name"]
    item = db.execute("SELECT name FROM inventory_items WHERE id = ?", (row["inventory_item_id"],)).fetchone()
    return item["name"] if item else "Deleted inventory item"


def allocation_out(row) -> dict:
    result = dict(row)
    for field in (
        "reserved_quantity", "issued_quantity", "returned_quantity", "consumed_quantity",
        "damaged_quantity", "lost_quantity", "distributed_quantity",
    ):
        result[field] = q(result[field])
    return result


def requirement_out(db, row) -> dict:
    result = dict(row)
    result["is_cancelled"] = bool(result["is_cancelled"])
    result["name"] = requirement_name(db, row)
    result["required_quantity"] = q(result["required_quantity"])
    allocations = db.execute(
        """SELECT inventory_allocations.*, inventory_locations.name AS source_location_name
           FROM inventory_allocations
           JOIN inventory_locations ON inventory_locations.id = inventory_allocations.source_location_id
           WHERE requirement_id = ? ORDER BY inventory_allocations.id""",
        (row["id"],),
    ).fetchall()
    result["allocations"] = [allocation_out(allocation) for allocation in allocations]
    result["inventory_reserved"] = q(sum(
        max(float(item["reserved_quantity"]) - float(item["issued_quantity"]), 0)
        for item in allocations if item["status"] in ("reserved", "issued")
    ))
    result["inventory_issued"] = q(sum(float(item["issued_quantity"]) for item in allocations))
    ordered = db.execute(
        """SELECT COALESCE(SUM(supplier_order_lines.quantity), 0)
           FROM supplier_order_lines
           JOIN supplier_orders ON supplier_orders.id = supplier_order_lines.supplier_order_id
           WHERE supplier_order_lines.requirement_id = ?
             AND supplier_orders.status IN ('confirmed', 'in_progress', 'completed')""",
        (row["id"],),
    ).fetchone()[0]
    fulfilled = db.execute(
        """SELECT COALESCE(SUM(supplier_order_fulfilments.quantity), 0)
           FROM supplier_order_fulfilments
           JOIN supplier_order_lines ON supplier_order_lines.id = supplier_order_fulfilments.line_id
           WHERE supplier_order_lines.requirement_id = ?
             AND supplier_order_fulfilments.fulfilment_type IN ('receipt', 'delivery', 'service_completion')""",
        (row["id"],),
    ).fetchone()[0]
    result["supplier_ordered"] = q(ordered)
    result["supplier_on_site"] = q(fulfilled)
    backfilled = db.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM event_logistics_backfills WHERE requirement_id = ?",
        (row["id"],),
    ).fetchone()[0]
    result["backfilled_on_site"] = q(backfilled)
    result["on_site"] = q(result["inventory_issued"] + result["supplier_on_site"] + result["backfilled_on_site"])
    result["still_to_source"] = q(max(
        float(result["required_quantity"]) - result["inventory_reserved"]
        - result["inventory_issued"] - result["supplier_ordered"] - result["backfilled_on_site"], 0
    ))
    result["not_yet_on_site"] = q(max(float(result["required_quantity"]) - result["on_site"], 0))
    reconciled = (
        all(item["status"] in ("reconciled", "released") for item in allocations)
        if allocations
        else result["requirement_type"] == "service" and result["supplier_on_site"] >= float(result["required_quantity"])
    )
    if result["is_cancelled"]:
        result["status"] = "cancelled"
    elif result["on_site"] >= float(result["required_quantity"]) and reconciled:
        result["status"] = "fulfilled"
    elif result["on_site"] >= float(result["required_quantity"]):
        result["status"] = "on_site"
    elif result["still_to_source"] <= 0:
        result["status"] = "sourced"
    else:
        result["status"] = "uncovered"
    return result


def template_requirement_out(db, row) -> dict:
    result = dict(row)
    result["name"] = requirement_name(db, row)
    return result


def require_event_requirement(db, event_id: int, requirement_id: int):
    row = db.execute(
        "SELECT * FROM event_logistics_requirements WHERE id = ? AND event_id = ?",
        (requirement_id, event_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Event logistics requirement {requirement_id} was not found")
    return row


def ensure_event_editable(db, event_id: int) -> None:
    event = require_row(db, "events", event_id, "Event")
    if event["status"] == "closed":
        raise HTTPException(409, "Closed Event logistics are read-only until reconciliation")


@router.post("/event-templates/{template_id}/logistics-requirements", status_code=201)
def create_template_requirement(template_id: int, payload: TemplateRequirementCreate, db: Connection) -> dict:
    require_row(db, "event_templates", template_id, "Event template")
    if payload.inventory_item_id is not None:
        item = require_row(db, "inventory_items", payload.inventory_item_id, "Inventory item")
        if item["unit"].lower() != payload.unit.strip().lower():
            raise HTTPException(422, f"Requirement unit must match the inventory item unit ({item['unit']})")
    row = db.execute(
        """INSERT INTO template_logistics_requirements
           (event_template_id, requirement_type, inventory_item_id, service_name,
            base_quantity, quantity_per_person, buffer_percentage, unit,
            relative_needed_day, priority, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
        (template_id, payload.requirement_type, payload.inventory_item_id,
         payload.service_name.strip() if payload.service_name else None,
         q(payload.base_quantity), q(payload.quantity_per_person), q(payload.buffer_percentage),
         payload.unit.strip(), payload.relative_needed_day, payload.priority, payload.notes),
    ).fetchone()
    db.commit()
    return template_requirement_out(db, row)


@router.get("/event-templates/{template_id}/logistics-requirements")
def list_template_requirements(template_id: int, db: Connection) -> dict:
    require_row(db, "event_templates", template_id, "Event template")
    rows = db.execute(
        "SELECT * FROM template_logistics_requirements WHERE event_template_id = ? ORDER BY id",
        (template_id,),
    ).fetchall()
    return {"items": [template_requirement_out(db, row) for row in rows], "total": len(rows)}


@router.patch("/event-templates/{template_id}/logistics-requirements/{requirement_id}")
def update_template_requirement(template_id: int, requirement_id: int, payload: TemplateRequirementUpdate, db: Connection) -> dict:
    row = db.execute(
        "SELECT * FROM template_logistics_requirements WHERE id = ? AND event_template_id = ?",
        (requirement_id, template_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Template logistics requirement {requirement_id} was not found")
    values = payload.model_dump(exclude_unset=True)
    for field in ("base_quantity", "quantity_per_person", "buffer_percentage"):
        if field in values:
            values[field] = q(values[field])
    if values:
        db.execute(
            f"UPDATE template_logistics_requirements SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
            [*values.values(), requirement_id],
        )
        db.commit()
    return template_requirement_out(db, require_row(db, "template_logistics_requirements", requirement_id, "Template logistics requirement"))


@router.delete("/event-templates/{template_id}/logistics-requirements/{requirement_id}", status_code=204)
def delete_template_requirement(template_id: int, requirement_id: int, db: Connection) -> Response:
    if db.execute(
        "DELETE FROM template_logistics_requirements WHERE id = ? AND event_template_id = ?",
        (requirement_id, template_id),
    ).rowcount == 0:
        raise HTTPException(404, f"Template logistics requirement {requirement_id} was not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/events/{event_id}/logistics-requirements", status_code=201)
def create_event_requirement(event_id: int, payload: EventRequirementCreate, db: Connection) -> dict:
    ensure_event_editable(db, event_id)
    event = require_row(db, "events", event_id, "Event")
    if payload.inventory_item_id is not None:
        item = require_row(db, "inventory_items", payload.inventory_item_id, "Inventory item")
        if item["unit"].lower() != payload.unit.strip().lower():
            raise HTTPException(422, f"Requirement unit must match the inventory item unit ({item['unit']})")
    row = db.execute(
        """INSERT INTO event_logistics_requirements
           (event_id, requirement_type, inventory_item_id, service_name, base_quantity,
            quantity_per_person, buffer_percentage, expected_attendance_snapshot,
            required_quantity, unit, needed_by, priority, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
        (event_id, payload.requirement_type, payload.inventory_item_id,
         payload.service_name.strip() if payload.service_name else None,
         q(payload.base_quantity), q(payload.quantity_per_person), q(payload.buffer_percentage),
         event["expected_attendance"], q(payload.required_quantity), payload.unit.strip(),
         payload.needed_by.isoformat(), payload.priority, payload.notes),
    ).fetchone()
    db.commit()
    return requirement_out(db, row)


@router.get("/events/{event_id}/logistics-requirements")
def list_event_requirements(event_id: int, db: Connection) -> dict:
    require_row(db, "events", event_id, "Event")
    rows = db.execute(
        "SELECT * FROM event_logistics_requirements WHERE event_id = ? ORDER BY needed_by, id",
        (event_id,),
    ).fetchall()
    return {"items": [requirement_out(db, row) for row in rows], "total": len(rows)}


@router.patch("/events/{event_id}/logistics-requirements/{requirement_id}")
def update_event_requirement(event_id: int, requirement_id: int, payload: EventRequirementUpdate, db: Connection) -> dict:
    ensure_event_editable(db, event_id)
    require_event_requirement(db, event_id, requirement_id)
    values = payload.model_dump(exclude_unset=True)
    if "required_quantity" in values:
        values["required_quantity"] = q(values["required_quantity"])
    if "needed_by" in values and values["needed_by"] is not None:
        values["needed_by"] = values["needed_by"].isoformat()
    if "is_cancelled" in values:
        values["is_cancelled"] = int(values["is_cancelled"])
        if values["is_cancelled"]:
            issued = db.execute(
                "SELECT COALESCE(SUM(issued_quantity), 0) FROM inventory_allocations WHERE requirement_id = ?",
                (requirement_id,),
            ).fetchone()[0]
            if issued > 0:
                raise HTTPException(409, "Issued inventory must be reconciled before cancelling the Requirement")
    if values:
        with db:
            db.execute(
                f"UPDATE event_logistics_requirements SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?",
                [*values.values(), requirement_id],
            )
            if values.get("is_cancelled"):
                db.execute(
                    "UPDATE inventory_allocations SET status = 'released', reserved_quantity = issued_quantity WHERE requirement_id = ?",
                    (requirement_id,),
                )
    return requirement_out(db, require_event_requirement(db, event_id, requirement_id))


@router.delete("/events/{event_id}/logistics-requirements/{requirement_id}", status_code=204)
def cancel_event_requirement(event_id: int, requirement_id: int, db: Connection) -> Response:
    update_event_requirement(event_id, requirement_id, EventRequirementUpdate(is_cancelled=True), db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/events/{event_id}/logistics-requirements/{requirement_id}/reserve", status_code=201)
def reserve_inventory(event_id: int, requirement_id: int, payload: ReserveAllocation, db: Connection) -> dict:
    ensure_event_editable(db, event_id)
    requirement = require_event_requirement(db, event_id, requirement_id)
    if requirement["requirement_type"] != "goods":
        raise HTTPException(422, "Services cannot reserve inventory")
    require_row(db, "inventory_locations", payload.location_id, "Inventory location")
    quantity = q(payload.quantity)
    if available_stock(db, requirement["inventory_item_id"], payload.location_id) < quantity:
        raise HTTPException(409, "Reservation exceeds available stock")
    row = db.execute(
        """INSERT INTO inventory_allocations
           (requirement_id, item_id, source_location_id, reserved_quantity)
           VALUES (?, ?, ?, ?) RETURNING *""",
        (requirement_id, requirement["inventory_item_id"], payload.location_id, quantity),
    ).fetchone()
    db.commit()
    return allocation_out(row)


@router.post("/events/{event_id}/logistics-requirements/{requirement_id}/backfill", status_code=201)
def backfill_requirement(event_id: int, requirement_id: int, payload: RequirementBackfill, db: Connection) -> dict:
    ensure_event_editable(db, event_id)
    requirement = require_event_requirement(db, event_id, requirement_id)
    quantity = q(payload.quantity)
    with db:
        db.execute(
            """INSERT INTO event_logistics_backfills (requirement_id, quantity, notes)
               VALUES (?, ?, ?)""",
            (requirement_id, quantity, payload.notes.strip()),
        )
    return requirement_out(db, require_event_requirement(db, event_id, requirement["id"]))


def require_allocation(db, event_id: int, requirement_id: int, allocation_id: int):
    require_event_requirement(db, event_id, requirement_id)
    row = db.execute(
        "SELECT * FROM inventory_allocations WHERE id = ? AND requirement_id = ?",
        (allocation_id, requirement_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Inventory allocation {allocation_id} was not found")
    return row


@router.post("/events/{event_id}/logistics-requirements/{requirement_id}/allocations/{allocation_id}/release")
def release_inventory(event_id: int, requirement_id: int, allocation_id: int, payload: AllocationQuantity, db: Connection) -> dict:
    ensure_event_editable(db, event_id)
    allocation = require_allocation(db, event_id, requirement_id, allocation_id)
    remaining = q(float(allocation["reserved_quantity"]) - float(allocation["issued_quantity"]))
    if payload.quantity > remaining:
        raise HTTPException(409, "Release exceeds the remaining reservation")
    new_reserved = q(float(allocation["reserved_quantity"]) - payload.quantity)
    new_status = "released" if new_reserved <= float(allocation["issued_quantity"]) else allocation["status"]
    db.execute(
        "UPDATE inventory_allocations SET reserved_quantity = ?, status = ? WHERE id = ?",
        (new_reserved, new_status, allocation_id),
    )
    db.commit()
    return allocation_out(require_row(db, "inventory_allocations", allocation_id, "Inventory allocation"))


@router.post("/events/{event_id}/logistics-requirements/{requirement_id}/allocations/{allocation_id}/issue")
def issue_inventory(event_id: int, requirement_id: int, allocation_id: int, payload: AllocationQuantity, db: Connection) -> dict:
    ensure_event_editable(db, event_id)
    allocation = require_allocation(db, event_id, requirement_id, allocation_id)
    remaining = q(float(allocation["reserved_quantity"]) - float(allocation["issued_quantity"]))
    quantity = q(payload.quantity)
    if quantity > remaining:
        raise HTTPException(409, "Issue exceeds the remaining reservation")
    with db:
        deduct_usable_lots(db, allocation["item_id"], allocation["source_location_id"], quantity)
        db.execute(
            "UPDATE inventory_allocations SET issued_quantity = issued_quantity + ?, status = 'issued' WHERE id = ?",
            (quantity, allocation_id),
        )
        db.execute(
            """INSERT INTO stock_movements
               (item_id, location_id, allocation_id, movement_type, quantity_delta, reason)
               VALUES (?, ?, ?, 'issue', ?, ?)""",
            (allocation["item_id"], allocation["source_location_id"], allocation_id, -quantity,
             f"Issued for Event logistics requirement {requirement_id}"),
        )
    return allocation_out(require_row(db, "inventory_allocations", allocation_id, "Inventory allocation"))


@router.post("/events/{event_id}/logistics-requirements/{requirement_id}/allocations/{allocation_id}/reconcile")
def reconcile_allocation(event_id: int, requirement_id: int, allocation_id: int, payload: AllocationReconcile, db: Connection) -> dict:
    event = require_row(db, "events", event_id, "Event")
    if event["status"] != "closed":
        raise HTTPException(409, "Allocation outcomes are recorded after the Event is closed")
    allocation = require_allocation(db, event_id, requirement_id, allocation_id)
    outcomes = q(payload.returned_quantity + payload.consumed_quantity + payload.damaged_quantity
                 + payload.lost_quantity + payload.distributed_quantity)
    if outcomes != q(allocation["issued_quantity"]):
        raise HTTPException(409, "Outcome quantities must equal the issued quantity")
    with db:
        db.execute(
            """UPDATE inventory_allocations SET returned_quantity = ?, consumed_quantity = ?,
               damaged_quantity = ?, lost_quantity = ?, distributed_quantity = ?, status = 'reconciled'
               WHERE id = ?""",
            (q(payload.returned_quantity), q(payload.consumed_quantity), q(payload.damaged_quantity),
             q(payload.lost_quantity), q(payload.distributed_quantity), allocation_id),
        )
        if payload.returned_quantity > 0:
            lot = db.execute(
                """INSERT INTO inventory_lots
                   (item_id, location_id, source_type, condition, current_quantity)
                   VALUES (?, ?, 'return', 'usable', ?) RETURNING id""",
                (allocation["item_id"], allocation["source_location_id"], q(payload.returned_quantity)),
            ).fetchone()
            db.execute(
                """INSERT INTO stock_movements
                   (item_id, lot_id, location_id, allocation_id, movement_type, quantity_delta, reason)
                   VALUES (?, ?, ?, ?, 'return', ?, ?)""",
                (allocation["item_id"], lot["id"], allocation["source_location_id"], allocation_id,
                 q(payload.returned_quantity), payload.notes or "Post-Event return"),
            )
        for movement_type, quantity in (
            ("consumption", payload.consumed_quantity), ("damage", payload.damaged_quantity),
            ("loss", payload.lost_quantity), ("distribution", payload.distributed_quantity),
        ):
            if quantity > 0:
                db.execute(
                    """INSERT INTO stock_movements
                       (item_id, location_id, allocation_id, movement_type, quantity_delta, reason)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (allocation["item_id"], allocation["source_location_id"], allocation_id,
                     movement_type, -q(quantity), payload.notes or f"Post-Event {movement_type}"),
                )
    return allocation_out(require_row(db, "inventory_allocations", allocation_id, "Inventory allocation"))


def attendance_forecast(db, event_id: int) -> dict:
    event = require_row(db, "events", event_id, "Event")
    registrations = db.execute(
        "SELECT COUNT(*) FROM participations WHERE event_id = ? AND rsvp_status = 1", (event_id,)
    ).fetchone()[0]
    condition = "events.event_template_id = ?" if event["event_template_id"] is not None else "0"
    params: list[object] = [event["event_template_id"]] if event["event_template_id"] is not None else []
    historical = db.execute(
        f"""SELECT events.id,
                   COUNT(CASE WHEN participations.rsvp_status = 1 THEN 1 END) AS registrations,
                   COUNT(CASE WHEN participations.attendance = 1 THEN 1 END) AS attended
            FROM events JOIN participations ON participations.event_id = events.id
            WHERE events.status = 'closed' AND events.id != ? AND ({condition})
              AND participations.attendance IS NOT NULL
            GROUP BY events.id HAVING registrations > 0""",
        [event_id, *params],
    ).fetchall()
    basis = "same_event_template"
    if len(historical) < 2 and event["beneficiary_id"] is not None:
        historical = db.execute(
            """SELECT events.id,
                      COUNT(CASE WHEN participations.rsvp_status = 1 THEN 1 END) AS registrations,
                      COUNT(CASE WHEN participations.attendance = 1 THEN 1 END) AS attended
               FROM events JOIN participations ON participations.event_id = events.id
               WHERE events.status = 'closed' AND events.id != ? AND events.beneficiary_id = ?
                 AND participations.attendance IS NOT NULL
               GROUP BY events.id HAVING registrations > 0""",
            (event_id, event["beneficiary_id"]),
        ).fetchall()
        basis = "same_beneficiary_group"
    if len(historical) < 2:
        return {"registrations": registrations, "historical_show_up_rate": None,
                "similar_event_sample_size": len(historical), "suggested_attendance": None,
                "calculation_basis": "insufficient_history"}
    historical_registrations = sum(row["registrations"] for row in historical)
    historical_attended = sum(row["attended"] for row in historical)
    rate = historical_attended / historical_registrations
    return {"registrations": registrations, "historical_show_up_rate": round(rate, 3),
            "similar_event_sample_size": len(historical),
            "suggested_attendance": math.ceil(registrations * rate),
            "calculation_basis": basis}


@router.get("/events/{event_id}/attendance-forecast")
def get_attendance_forecast(event_id: int, db: Connection) -> dict:
    return attendance_forecast(db, event_id)


def reconciliation_out(db, event_id: int) -> dict:
    row = db.execute("SELECT * FROM event_logistics_reconciliations WHERE event_id = ?", (event_id,)).fetchone()
    if row is None:
        return {"event_id": event_id, "status": "not_started", "completed_at": None, "notes": ""}
    return dict(row)


@router.get("/events/{event_id}/logistics")
def event_logistics(event_id: int, db: Connection) -> dict:
    event = require_row(db, "events", event_id, "Event")
    requirements = list_event_requirements(event_id, db)["items"]
    bookings = [dict(row) for row in db.execute(
        """SELECT event_venue_bookings.*, venues.name AS venue_name, venue_spaces.name AS space_name,
                  venue_spaces.pax_capacity
           FROM event_venue_bookings
           JOIN venue_spaces ON venue_spaces.id = event_venue_bookings.venue_space_id
           JOIN venues ON venues.id = venue_spaces.venue_id
           WHERE event_id = ? ORDER BY is_primary DESC, start_at""", (event_id,)
    ).fetchall()]
    warnings = []
    for requirement in requirements:
        if requirement["still_to_source"] > 0:
            warnings.append({"type": "shortage", "requirement_id": requirement["id"],
                             "message": f"{requirement['name']}: {requirement['still_to_source']} {requirement['unit']} still to source"})
        if requirement["not_yet_on_site"] > 0 and requirement["needed_by"] < datetime.now().isoformat():
            warnings.append({"type": "late_delivery", "requirement_id": requirement["id"],
                             "message": f"{requirement['name']} is not fully on site"})
        late_order = db.execute(
            """SELECT supplier_orders.id, supplier_orders.delivery_end
               FROM supplier_order_lines
               JOIN supplier_orders ON supplier_orders.id = supplier_order_lines.supplier_order_id
               WHERE supplier_order_lines.requirement_id = ?
                 AND supplier_orders.status IN ('confirmed', 'in_progress')
                 AND supplier_orders.delivery_end IS NOT NULL
                 AND datetime(supplier_orders.delivery_end) > datetime(?)
               ORDER BY supplier_orders.delivery_end DESC LIMIT 1""",
            (requirement["id"], requirement["needed_by"]),
        ).fetchone()
        if late_order:
            warnings.append({"type": "late_delivery", "requirement_id": requirement["id"],
                             "message": f"{requirement['name']}: Order #{late_order['id']} is scheduled after the needed-by time"})
    for booking in bookings:
        booking["is_primary"] = bool(booking["is_primary"])
        if event["expected_attendance"] and booking["pax_capacity"] and event["expected_attendance"] > booking["pax_capacity"]:
            warnings.append({"type": "capacity", "booking_id": booking["id"],
                             "message": f"Expected attendance exceeds {booking['space_name']} capacity"})
    expiring = db.execute(
        """SELECT DISTINCT inventory_items.name FROM inventory_allocations
           JOIN inventory_lots ON inventory_lots.item_id = inventory_allocations.item_id
             AND inventory_lots.location_id = inventory_allocations.source_location_id
           JOIN inventory_items ON inventory_items.id = inventory_allocations.item_id
           JOIN event_logistics_requirements ON event_logistics_requirements.id = inventory_allocations.requirement_id
           WHERE event_logistics_requirements.event_id = ? AND inventory_lots.expiry_date IS NOT NULL
             AND date(inventory_lots.expiry_date) <= date(event_logistics_requirements.needed_by)""", (event_id,)
    ).fetchall()
    warnings.extend({"type": "expiring_stock", "message": f"{row['name']} stock may expire before it is needed"} for row in expiring)
    return {"event": {"id": event["id"], "name": event["name"], "status": event["status"],
                      "expected_attendance": event["expected_attendance"]},
            "forecast": attendance_forecast(db, event_id), "requirements": requirements,
            "venue_bookings": bookings, "reconciliation": reconciliation_out(db, event_id),
            "warnings": warnings}


@router.post("/events/{event_id}/logistics/reconciliation/finalize")
def finalize_reconciliation(event_id: int, payload: ReconciliationFinalize, db: Connection) -> dict:
    event = require_row(db, "events", event_id, "Event")
    if event["status"] != "closed":
        raise HTTPException(409, "Only closed Events can be reconciled")
    unresolved_allocations = db.execute(
        """SELECT COUNT(*) FROM inventory_allocations
           JOIN event_logistics_requirements ON event_logistics_requirements.id = inventory_allocations.requirement_id
           WHERE event_logistics_requirements.event_id = ? AND inventory_allocations.issued_quantity > 0
             AND inventory_allocations.status != 'reconciled'""", (event_id,)
    ).fetchone()[0]
    unresolved_rentals = db.execute(
        """SELECT COUNT(*) FROM supplier_orders WHERE event_id = ? AND order_type = 'rental'
           AND status IN ('confirmed', 'in_progress')""", (event_id,)
    ).fetchone()[0]
    if unresolved_allocations or unresolved_rentals:
        raise HTTPException(409, "Issued stock and active rentals must be resolved before finalizing")
    db.execute(
        """INSERT INTO event_logistics_reconciliations (event_id, status, completed_at, notes)
           VALUES (?, 'completed', CURRENT_TIMESTAMP, ?)
           ON CONFLICT(event_id) DO UPDATE SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
             notes = excluded.notes, updated_at = CURRENT_TIMESTAMP""",
        (event_id, payload.notes),
    )
    db.commit()
    return reconciliation_out(db, event_id)
