"""Structured venue bookings and aggregate donation batch operations."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response

from backend.api.routes._common import Connection, Pagination, list_envelope
from backend.api.routes.inventory import deduct_usable_lots, q, require_row
from backend.schema.venues import (
    DonationBatchCreate,
    DonationSort,
    VenueBookingCreate,
    VenueBookingUpdate,
    VenueCreate,
    VenueSpaceCreate,
    VenueSpaceUpdate,
    VenueUpdate,
)

router = APIRouter(tags=["venues and donations"])


def venue_out(db, venue_id: int) -> dict:
    row = db.execute(
        """SELECT venues.*, external_organizations.name AS managing_organization_name
           FROM venues LEFT JOIN external_organizations
             ON external_organizations.id = venues.managing_organization_id
           WHERE venues.id = ?""", (venue_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Venue {venue_id} was not found")
    result = dict(row)
    result["is_active"] = bool(result["is_active"])
    result["spaces"] = [space_out(item) for item in db.execute(
        "SELECT * FROM venue_spaces WHERE venue_id = ? ORDER BY name", (venue_id,)
    ).fetchall()]
    result["booking_count"] = db.execute(
        """SELECT COUNT(*) FROM event_venue_bookings
           JOIN venue_spaces ON venue_spaces.id = event_venue_bookings.venue_space_id
           WHERE venue_spaces.venue_id = ? AND event_venue_bookings.status != 'cancelled'""", (venue_id,)
    ).fetchone()[0]
    return result


def space_out(row) -> dict:
    result = dict(row)
    result["is_active"] = bool(result["is_active"])
    return result


def booking_out(db, booking_id: int) -> dict:
    row = db.execute(
        """SELECT event_venue_bookings.*, venue_spaces.name AS space_name,
                  venue_spaces.pax_capacity, venues.id AS venue_id, venues.name AS venue_name,
                  events.expected_attendance
           FROM event_venue_bookings
           JOIN venue_spaces ON venue_spaces.id = event_venue_bookings.venue_space_id
           JOIN venues ON venues.id = venue_spaces.venue_id
           JOIN events ON events.id = event_venue_bookings.event_id
           WHERE event_venue_bookings.id = ?""", (booking_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Venue booking {booking_id} was not found")
    result = dict(row)
    result["is_primary"] = bool(result["is_primary"])
    result["capacity_warning"] = bool(
        result["pax_capacity"] is not None and result["expected_attendance"] is not None
        and result["expected_attendance"] > result["pax_capacity"]
    )
    return result


def donation_out(db, batch_id: int) -> dict:
    row = db.execute(
        """SELECT donation_batches.*, external_organizations.name AS source_organization_name,
                  events.name AS event_name
           FROM donation_batches
           LEFT JOIN external_organizations ON external_organizations.id = donation_batches.source_organization_id
           LEFT JOIN events ON events.id = donation_batches.event_id
           WHERE donation_batches.id = ?""", (batch_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Donation batch {batch_id} was not found")
    result = dict(row)
    totals = db.execute(
        """SELECT condition, ROUND(SUM(current_quantity), 3) AS quantity
           FROM inventory_lots WHERE donation_batch_id = ? GROUP BY condition""", (batch_id,)
    ).fetchall()
    result["quantities_by_condition"] = {item["condition"]: q(item["quantity"]) for item in totals}
    result["distributed_quantity"] = q(abs(db.execute(
        """SELECT COALESCE(SUM(quantity_delta), 0) FROM stock_movements
           WHERE donation_batch_id = ? AND movement_type = 'distribution'""",
        (batch_id,),
    ).fetchone()[0]))
    return result


@router.post("/venues", status_code=201)
def create_venue(payload: VenueCreate, db: Connection) -> dict:
    row = db.execute(
        """INSERT INTO venues (name, address, managing_organization_id, notes, is_active)
           VALUES (?, ?, ?, ?, ?) RETURNING id""",
        (payload.name.strip(), payload.address, payload.managing_organization_id,
         payload.notes, int(payload.is_active)),
    ).fetchone()
    db.commit()
    return venue_out(db, row["id"])


@router.get("/venues")
def list_venues(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM venues").fetchone()[0]
    ids = db.execute("SELECT id FROM venues ORDER BY name LIMIT ? OFFSET ?", (pagination.limit, pagination.offset)).fetchall()
    return list_envelope([venue_out(db, item["id"]) for item in ids], total, pagination)


@router.get("/venues/{venue_id}")
def get_venue(venue_id: int, db: Connection) -> dict:
    result = venue_out(db, venue_id)
    result["bookings"] = [dict(row) for row in db.execute(
        """SELECT event_venue_bookings.*, events.name AS event_name, venue_spaces.name AS space_name
           FROM event_venue_bookings
           JOIN events ON events.id = event_venue_bookings.event_id
           JOIN venue_spaces ON venue_spaces.id = event_venue_bookings.venue_space_id
           WHERE venue_spaces.venue_id = ? ORDER BY start_at DESC""", (venue_id,)
    ).fetchall()]
    return result


@router.patch("/venues/{venue_id}")
def update_venue(venue_id: int, payload: VenueUpdate, db: Connection) -> dict:
    require_row(db, "venues", venue_id, "Venue")
    values = payload.model_dump(exclude_unset=True)
    if "is_active" in values:
        values["is_active"] = int(values["is_active"])
    if values:
        db.execute(f"UPDATE venues SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?", [*values.values(), venue_id])
        db.commit()
    return venue_out(db, venue_id)


@router.delete("/venues/{venue_id}", status_code=204)
def deactivate_venue(venue_id: int, db: Connection) -> Response:
    require_row(db, "venues", venue_id, "Venue")
    with db:
        db.execute("UPDATE venues SET is_active = 0 WHERE id = ?", (venue_id,))
        db.execute("UPDATE venue_spaces SET is_active = 0 WHERE venue_id = ?", (venue_id,))
    return Response(status_code=204)


@router.post("/venues/{venue_id}/spaces", status_code=201)
def create_space(venue_id: int, payload: VenueSpaceCreate, db: Connection) -> dict:
    require_row(db, "venues", venue_id, "Venue")
    row = db.execute(
        """INSERT INTO venue_spaces
           (venue_id, name, pax_capacity, accessibility_information, is_active)
           VALUES (?, ?, ?, ?, ?) RETURNING *""",
        (venue_id, payload.name.strip(), payload.pax_capacity,
         payload.accessibility_information, int(payload.is_active)),
    ).fetchone()
    db.commit()
    return space_out(row)


@router.patch("/venues/{venue_id}/spaces/{space_id}")
def update_space(venue_id: int, space_id: int, payload: VenueSpaceUpdate, db: Connection) -> dict:
    row = db.execute("SELECT * FROM venue_spaces WHERE id = ? AND venue_id = ?", (space_id, venue_id)).fetchone()
    if row is None:
        raise HTTPException(404, f"Venue space {space_id} was not found")
    values = payload.model_dump(exclude_unset=True)
    if "is_active" in values:
        values["is_active"] = int(values["is_active"])
    if values:
        db.execute(f"UPDATE venue_spaces SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?", [*values.values(), space_id])
        db.commit()
    return space_out(require_row(db, "venue_spaces", space_id, "Venue space"))


@router.delete("/venues/{venue_id}/spaces/{space_id}", status_code=204)
def deactivate_space(venue_id: int, space_id: int, db: Connection) -> Response:
    if db.execute(
        "UPDATE venue_spaces SET is_active = 0 WHERE id = ? AND venue_id = ?",
        (space_id, venue_id),
    ).rowcount == 0:
        raise HTTPException(404, f"Venue space {space_id} was not found")
    db.commit()
    return Response(status_code=204)


def ensure_no_overlap(db, event_id: int, space_id: int, start_at: str, end_at: str, booking_id: int | None = None) -> None:
    conflict = db.execute(
        """SELECT id FROM event_venue_bookings
           WHERE venue_space_id = ? AND status = 'confirmed'
             AND id != COALESCE(?, -1)
             AND datetime(start_at) < datetime(?) AND datetime(end_at) > datetime(?)""",
        (space_id, booking_id, end_at, start_at),
    ).fetchone()
    if conflict:
        raise HTTPException(409, "This Venue Space already has an overlapping confirmed booking")


@router.post("/events/{event_id}/venue-bookings", status_code=201)
def create_booking(event_id: int, payload: VenueBookingCreate, db: Connection) -> dict:
    event = require_row(db, "events", event_id, "Event")
    if event["status"] == "closed":
        raise HTTPException(409, "Venue Bookings for a closed Event are read-only")
    space = require_row(db, "venue_spaces", payload.venue_space_id, "Venue space")
    if payload.end_at <= payload.start_at:
        raise HTTPException(422, "Booking end must be after its start")
    if payload.status == "confirmed":
        ensure_no_overlap(db, event_id, payload.venue_space_id, payload.start_at.isoformat(), payload.end_at.isoformat())
    with db:
        if payload.is_primary:
            db.execute("UPDATE event_venue_bookings SET is_primary = 0 WHERE event_id = ?", (event_id,))
        row = db.execute(
            """INSERT INTO event_venue_bookings
               (event_id, venue_space_id, is_primary, status, start_at, end_at,
                cost_sgd_cents, contact_id, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
            (event_id, payload.venue_space_id, int(payload.is_primary), payload.status,
             payload.start_at.isoformat(), payload.end_at.isoformat(), payload.cost_sgd_cents,
             payload.contact_id, payload.notes),
        ).fetchone()
        if payload.is_primary:
            venue = require_row(db, "venues", space["venue_id"], "Venue")
            db.execute("UPDATE events SET venue = ? WHERE id = ?", (f"{venue['name']} · {space['name']}", event_id))
    return booking_out(db, row["id"])


@router.get("/events/{event_id}/venue-bookings")
def list_bookings(event_id: int, db: Connection) -> dict:
    require_row(db, "events", event_id, "Event")
    ids = db.execute("SELECT id FROM event_venue_bookings WHERE event_id = ? ORDER BY is_primary DESC, start_at", (event_id,)).fetchall()
    return {"items": [booking_out(db, item["id"]) for item in ids], "total": len(ids)}


@router.patch("/events/{event_id}/venue-bookings/{booking_id}")
def update_booking(event_id: int, booking_id: int, payload: VenueBookingUpdate, db: Connection) -> dict:
    event = require_row(db, "events", event_id, "Event")
    if event["status"] == "closed":
        raise HTTPException(409, "Venue Bookings for a closed Event are read-only")
    existing = db.execute("SELECT * FROM event_venue_bookings WHERE id = ? AND event_id = ?", (booking_id, event_id)).fetchone()
    if existing is None:
        raise HTTPException(404, f"Venue booking {booking_id} was not found")
    values = payload.model_dump(exclude_unset=True)
    start_at = (values.get("start_at") or datetime.fromisoformat(existing["start_at"])).isoformat()
    end_at = (values.get("end_at") or datetime.fromisoformat(existing["end_at"])).isoformat()
    space_id = values.get("venue_space_id", existing["venue_space_id"])
    booking_status = values.get("status", existing["status"])
    if end_at <= start_at:
        raise HTTPException(422, "Booking end must be after its start")
    if booking_status == "confirmed":
        ensure_no_overlap(db, event_id, space_id, start_at, end_at, booking_id)
    for field in ("start_at", "end_at"):
        if field in values and values[field] is not None:
            values[field] = values[field].isoformat()
    if "is_primary" in values:
        values["is_primary"] = int(values["is_primary"])
    with db:
        if values.get("is_primary"):
            db.execute("UPDATE event_venue_bookings SET is_primary = 0 WHERE event_id = ?", (event_id,))
        if values:
            db.execute(f"UPDATE event_venue_bookings SET {', '.join(f'{key} = ?' for key in values)} WHERE id = ?", [*values.values(), booking_id])
        updated = booking_out(db, booking_id)
        if updated["is_primary"] and updated["status"] != "cancelled":
            db.execute(
                "UPDATE events SET venue = ? WHERE id = ?",
                (f"{updated['venue_name']} · {updated['space_name']}", event_id),
            )
    return booking_out(db, booking_id)


@router.post("/donation-batches", status_code=201)
def create_donation(payload: DonationBatchCreate, db: Connection) -> dict:
    row = db.execute(
        """INSERT INTO donation_batches
           (event_id, source_organization_id, collection_at, container_count, container_unit, notes)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id""",
        (payload.event_id, payload.source_organization_id,
         payload.collection_at.isoformat() if payload.collection_at else None,
         payload.container_count, payload.container_unit, payload.notes),
    ).fetchone()
    db.commit()
    return donation_out(db, row["id"])


@router.get("/donation-batches")
def list_donations(db: Connection, pagination: Annotated[Pagination, Depends()]) -> dict:
    total = db.execute("SELECT COUNT(*) FROM donation_batches").fetchone()[0]
    ids = db.execute("SELECT id FROM donation_batches ORDER BY id DESC LIMIT ? OFFSET ?", (pagination.limit, pagination.offset)).fetchall()
    return list_envelope([donation_out(db, item["id"]) for item in ids], total, pagination)


@router.get("/donation-batches/{batch_id}")
def get_donation(batch_id: int, db: Connection) -> dict:
    return donation_out(db, batch_id)


def donation_transition(db, batch_id: int, target: str, time_field: str | None = None) -> dict:
    require_row(db, "donation_batches", batch_id, "Donation batch")
    assignment = f", {time_field} = CURRENT_TIMESTAMP" if time_field else ""
    db.execute(f"UPDATE donation_batches SET status = ?{assignment} WHERE id = ?", (target, batch_id))
    db.commit()
    return donation_out(db, batch_id)


@router.post("/donation-batches/{batch_id}/collect")
def collect_donation(batch_id: int, db: Connection) -> dict:
    return donation_transition(db, batch_id, "collected", "collection_at")


@router.post("/donation-batches/{batch_id}/receive")
def receive_donation(batch_id: int, db: Connection) -> dict:
    return donation_transition(db, batch_id, "received", "received_at")


@router.post("/donation-batches/{batch_id}/sort", status_code=201)
def sort_donation(batch_id: int, payload: DonationSort, db: Connection) -> dict:
    batch = require_row(db, "donation_batches", batch_id, "Donation batch")
    require_row(db, "inventory_items", payload.item_id, "Inventory item")
    require_row(db, "inventory_locations", payload.location_id, "Inventory location")
    with db:
        lot = db.execute(
            """INSERT INTO inventory_lots
               (item_id, location_id, source_type, donation_batch_id, expiry_date,
                condition, current_quantity)
               VALUES (?, ?, 'donation', ?, ?, ?, ?) RETURNING *""",
            (payload.item_id, payload.location_id, batch_id, payload.expiry_date,
             payload.condition, q(payload.quantity)),
        ).fetchone()
        db.execute("UPDATE donation_batches SET status = 'sorting' WHERE id = ?", (batch_id,))
        db.execute(
            """INSERT INTO stock_movements
               (item_id, lot_id, location_id, donation_batch_id, movement_type, quantity_delta, reason)
               VALUES (?, ?, ?, ?, 'receipt', ?, ?)""",
            (payload.item_id, lot["id"], payload.location_id, batch_id, q(payload.quantity),
             f"Donation batch {batch_id} sorted as {payload.condition}"),
        )
    return dict(lot)


@router.post("/donation-batches/{batch_id}/sorting-complete")
def complete_sorting(batch_id: int, db: Connection) -> dict:
    return donation_transition(db, batch_id, "sorted", "sorting_completed_at")


@router.post("/donation-batches/{batch_id}/distribute", status_code=201)
def distribute_donation(batch_id: int, payload: DonationSort, db: Connection) -> dict:
    require_row(db, "donation_batches", batch_id, "Donation batch")
    quantity = q(payload.quantity)
    with db:
        deduct_usable_lots(db, payload.item_id, payload.location_id, quantity)
        movement = db.execute(
            """INSERT INTO stock_movements
               (item_id, location_id, donation_batch_id, movement_type, quantity_delta, reason)
               VALUES (?, ?, ?, 'distribution', ?, ?) RETURNING *""",
            (payload.item_id, payload.location_id, batch_id, -quantity, f"Donation batch {batch_id} distribution"),
        ).fetchone()
        db.execute("UPDATE donation_batches SET status = 'distributed', distribution_at = CURRENT_TIMESTAMP WHERE id = ?", (batch_id,))
    return dict(movement)


@router.post("/donation-batches/{batch_id}/close")
def close_donation(batch_id: int, db: Connection) -> dict:
    return donation_transition(db, batch_id, "closed")
