"""Demo data for organizer and volunteer development, modelled on Passion to
Serve's Wellness and Distribution event use cases.

Run with:

    python3 -m backend.seed
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from backend.database import DEFAULT_DATABASE_PATH, connect, initialize_database

ROLE_CATEGORY = "volunteer"

# Phone numbers that should always have WhatsApp bot admin access, regardless
# of whether anyone has linked them through the admin panel. Digits only, SG
# country code included (e.g. "6593430297"), matching the format Meta's
# webhook reports senders in.
ADMIN_WHATSAPP_LINKS: list[tuple[str, str]] = [
    ("John", "6593430297"),
]


def seed_admin_whatsapp_links(db) -> None:
    """Ensure ADMIN_WHATSAPP_LINKS always have bot admin access.

    Called on every app startup (not gated behind "does the DB already have
    data" like seed() below) so these numbers keep working even after a
    database reset — e.g. Render's free tier wiping the ephemeral disk on
    restart. Safe to run repeatedly: never overwrites an existing link to a
    different team member, and reuses the team member record if it already
    exists (matched by email).
    """

    # Local import: avoids a circular import, since backend.bot.commands
    # doesn't need to know about backend.seed.
    from backend.bot.commands import get_or_create_contact

    for name, phone_number in ADMIN_WHATSAPP_LINKS:
        email = f"{name.lower().replace(' ', '.')}@passiontoserve.org"
        row = db.execute("SELECT id FROM team_members WHERE email = ?", (email,)).fetchone()
        if row is None:
            member_id = db.execute(
                "INSERT INTO team_members (name, email) VALUES (?, ?) RETURNING id",
                (name, email),
            ).fetchone()[0]
        else:
            member_id = row[0]

        contact = get_or_create_contact(db, phone_number)
        if contact["team_member_id"] is None:
            db.execute(
                "UPDATE whatsapp_contacts SET team_member_id = ? WHERE id = ?",
                (member_id, contact["id"]),
            )
        db.commit()


def seed_logistics(db) -> None:
    """Add a small, idempotent logistics catalogue for local UI development."""

    organizations = [
        ("CareWell Supplies", ["supplier", "donor"]),
        ("Community Transit", ["transport_provider", "supplier"]),
        ("People's Association Hub", ["venue_partner", "government_agency"]),
        ("Bright Futures Foundation", ["donor", "ngo"]),
    ]
    organization_ids = {}
    for name, capabilities in organizations:
        db.execute("INSERT OR IGNORE INTO external_organizations (name) VALUES (?)", (name,))
        organization_id = db.execute(
            "SELECT id FROM external_organizations WHERE name = ?", (name,)
        ).fetchone()[0]
        organization_ids[name] = organization_id
        db.executemany(
            "INSERT OR IGNORE INTO organization_capabilities (organization_id, capability) VALUES (?, ?)",
            [(organization_id, capability) for capability in capabilities],
        )
    if db.execute(
        "SELECT COUNT(*) FROM organization_contacts WHERE organization_id = ?",
        (organization_ids["CareWell Supplies"],),
    ).fetchone()[0] == 0:
        db.execute(
            """INSERT INTO organization_contacts
               (organization_id, name, role, email, phone, is_primary)
               VALUES (?, 'Mei Lin', 'Account manager', 'mei@carewell.example', '+65 6123 4567', 1)""",
            (organization_ids["CareWell Supplies"],),
        )
    if db.execute(
        "SELECT COUNT(*) FROM organization_contacts WHERE organization_id = ?",
        (organization_ids["Community Transit"],),
    ).fetchone()[0] == 0:
        db.execute(
            """INSERT INTO organization_contacts
               (organization_id, name, role, email, phone, is_primary)
               VALUES (?, 'Daniel Lim', 'Operations coordinator',
                       'daniel@communitytransit.example', '+65 6234 5678', 1)""",
            (organization_ids["Community Transit"],),
        )

    item_definitions = [
        ("Drinking water", "WATER-1L", "litre", "consumable", 40, 220),
        ("Folding chairs", "CHAIR-FOLD", "piece", "reusable", 20, 90),
        ("First-aid kits", "FIRST-AID", "kit", "reusable", 3, 8),
    ]
    item_ids = {}
    for name, sku, unit, item_type, reorder, opening in item_definitions:
        db.execute(
            """INSERT OR IGNORE INTO inventory_items
               (name, sku, unit, item_type, reorder_level)
               VALUES (?, ?, ?, ?, ?)""",
            (name, sku, unit, item_type, reorder),
        )
        item_id = db.execute("SELECT id FROM inventory_items WHERE sku = ?", (sku,)).fetchone()[0]
        item_ids[sku] = item_id

    location = db.execute(
        "SELECT id FROM inventory_locations WHERE name = 'Main Store' LIMIT 1"
    ).fetchone()
    if location is None:
        location_id = db.execute(
            "INSERT INTO inventory_locations (name, address) VALUES ('Main Store', 'Central operations store') RETURNING id"
        ).fetchone()[0]
    else:
        location_id = location[0]
    for _name, sku, _unit, _item_type, _reorder, opening in item_definitions:
        item_id = item_ids[sku]
        if db.execute("SELECT COUNT(*) FROM inventory_lots WHERE item_id = ?", (item_id,)).fetchone()[0] == 0:
            lot_id = db.execute(
                """INSERT INTO inventory_lots
                   (item_id, location_id, source_type, condition, current_quantity)
                   VALUES (?, ?, 'adjustment', 'usable', ?) RETURNING id""",
                (item_id, location_id, opening),
            ).fetchone()[0]
            db.execute(
                """INSERT INTO stock_movements
                   (item_id, lot_id, location_id, movement_type, quantity_delta, reason)
                   VALUES (?, ?, ?, 'adjustment', ?, 'Demo opening balance')""",
                (item_id, lot_id, location_id, opening),
            )

    venue = db.execute("SELECT id FROM venues WHERE name = 'Tampines Hub' LIMIT 1").fetchone()
    if venue is None:
        venue_id = db.execute(
            """INSERT INTO venues (name, address, managing_organization_id)
               VALUES ('Tampines Hub', '1 Tampines Walk', ?) RETURNING id""",
            (organization_ids["People's Association Hub"],),
        ).fetchone()[0]
        db.execute(
            """INSERT INTO venue_spaces
               (venue_id, name, pax_capacity, accessibility_information)
               VALUES (?, 'Community Hall', 120, 'Step-free access and accessible washroom')""",
            (venue_id,),
        )

    for template in db.execute("SELECT id, name FROM event_templates").fetchall():
        if db.execute(
            "SELECT COUNT(*) FROM template_logistics_requirements WHERE event_template_id = ?",
            (template["id"],),
        ).fetchone()[0] > 0:
            continue
        is_distribution = "distribution" in template["name"].lower()
        requirements = [
            (item_ids["WATER-1L"], 10, .6, 10, "litre", -1),
            (item_ids["FIRST-AID"], 1, 0, 0, "kit", -1),
        ]
        if is_distribution:
            requirements.append((item_ids["CHAIR-FOLD"], 20, .1, 5, "piece", -1))
        for item_id, base, per_person, buffer, unit, relative_day in requirements:
            db.execute(
                """INSERT INTO template_logistics_requirements
                   (event_template_id, requirement_type, inventory_item_id,
                    base_quantity, quantity_per_person, buffer_percentage, unit,
                    relative_needed_day)
                   VALUES (?, 'goods', ?, ?, ?, ?, ?, ?)""",
                (template["id"], item_id, base, per_person, buffer, unit, relative_day),
            )

    for event in db.execute("SELECT * FROM events").fetchall():
        if event["expected_attendance"] is None:
            db.execute("UPDATE events SET expected_attendance = 80 WHERE id = ?", (event["id"],))
        if db.execute(
            "SELECT COUNT(*) FROM event_logistics_requirements WHERE event_id = ?", (event["id"],)
        ).fetchone()[0] == 0 and event["event_template_id"] is not None:
            for requirement in db.execute(
                "SELECT * FROM template_logistics_requirements WHERE event_template_id = ?",
                (event["event_template_id"],),
            ).fetchall():
                attendance = event["expected_attendance"] or 80
                required = math.ceil((requirement["base_quantity"] + requirement["quantity_per_person"] * attendance) * (1 + requirement["buffer_percentage"] / 100))
                needed_by = (date.fromisoformat(event["event_date"]) + timedelta(days=requirement["relative_needed_day"])).isoformat()
                db.execute(
                    """INSERT INTO event_logistics_requirements
                       (event_id, template_requirement_id, requirement_type, inventory_item_id,
                        service_name, base_quantity, quantity_per_person, buffer_percentage,
                        expected_attendance_snapshot, required_quantity, unit, needed_by, priority, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (event["id"], requirement["id"], requirement["requirement_type"],
                     requirement["inventory_item_id"], requirement["service_name"],
                     requirement["base_quantity"], requirement["quantity_per_person"],
                     requirement["buffer_percentage"], attendance, required, requirement["unit"],
                     needed_by, requirement["priority"], requirement["notes"]),
                )
        if event["status"] == "closed":
            db.execute(
                "INSERT OR IGNORE INTO event_logistics_reconciliations (event_id, status) VALUES (?, 'pending')",
                (event["id"],),
            )

    event_ids = {
        row["name"]: row["id"]
        for row in db.execute(
            "SELECT id, name FROM events WHERE name IN (?, ?, ?)",
            (
                "Yoga at Tampines Hub",
                "Zumba at Boon Lay Dormitory",
                "Clothes & Essentials Distribution",
            ),
        ).fetchall()
    }

    def create_donation(
        marker: str,
        *,
        event_name: str | None,
        organization_name: str,
        container_count: float,
        container_unit: str,
        status: str,
        collection_at: str | None = None,
        received_at: str | None = None,
        sorting_completed_at: str | None = None,
        distribution_at: str | None = None,
    ) -> int | None:
        existing = db.execute(
            "SELECT id FROM donation_batches WHERE notes = ?", (marker,)
        ).fetchone()
        if existing is not None:
            return existing[0]
        event_id = event_ids.get(event_name) if event_name else None
        if event_name and event_id is None:
            return None
        return db.execute(
            """INSERT INTO donation_batches
               (event_id, source_organization_id, collection_at, received_at,
                sorting_completed_at, distribution_at, container_count,
                container_unit, status, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
            (
                event_id,
                organization_ids[organization_name],
                collection_at,
                received_at,
                sorting_completed_at,
                distribution_at,
                container_count,
                container_unit,
                status,
                marker,
            ),
        ).fetchone()[0]

    planned_donation_id = create_donation(
        "Demo donation: August essentials collection",
        event_name="Clothes & Essentials Distribution",
        organization_name="Bright Futures Foundation",
        container_count=12,
        container_unit="boxes",
        status="collected",
        collection_at="2026-08-01 10:00:00",
    )
    sorting_donation_id = create_donation(
        "Demo donation: chairs awaiting sorting",
        event_name="Clothes & Essentials Distribution",
        organization_name="CareWell Supplies",
        container_count=6,
        container_unit="cages",
        status="sorting",
        collection_at="2026-07-27 09:00:00",
        received_at="2026-07-27 15:30:00",
    )
    distributed_donation_id = create_donation(
        "Demo donation: bottled water distribution",
        event_name="Yoga at Tampines Hub",
        organization_name="Bright Futures Foundation",
        container_count=10,
        container_unit="cartons",
        status="distributed",
        collection_at="2026-06-10 10:00:00",
        received_at="2026-06-10 14:00:00",
        sorting_completed_at="2026-06-11 16:00:00",
        distribution_at="2026-06-14 12:00:00",
    )

    def add_donation_lot(
        donation_id: int | None,
        item_id: int,
        condition: str,
        received_quantity: float,
        remaining_quantity: float,
    ) -> None:
        if donation_id is None or db.execute(
            "SELECT COUNT(*) FROM inventory_lots WHERE donation_batch_id = ? AND item_id = ?",
            (donation_id, item_id),
        ).fetchone()[0] > 0:
            return
        lot_id = db.execute(
            """INSERT INTO inventory_lots
               (item_id, location_id, source_type, donation_batch_id,
                received_date, condition, current_quantity)
               VALUES (?, ?, 'donation', ?, '2026-07-27', ?, ?) RETURNING id""",
            (item_id, location_id, donation_id, condition, remaining_quantity),
        ).fetchone()[0]
        db.execute(
            """INSERT INTO stock_movements
               (item_id, lot_id, location_id, donation_batch_id,
                movement_type, quantity_delta, reason)
               VALUES (?, ?, ?, ?, 'receipt', ?, 'Demo donation received')""",
            (item_id, lot_id, location_id, donation_id, received_quantity),
        )
        distributed_quantity = received_quantity - remaining_quantity
        if distributed_quantity > 0:
            db.execute(
                """INSERT INTO stock_movements
                   (item_id, lot_id, location_id, donation_batch_id,
                    movement_type, quantity_delta, reason)
                   VALUES (?, ?, ?, ?, 'distribution', ?, 'Distributed at Demo Event')""",
                (
                    item_id,
                    lot_id,
                    location_id,
                    donation_id,
                    -distributed_quantity,
                ),
            )

    add_donation_lot(sorting_donation_id, item_ids["CHAIR-FOLD"], "pending_sort", 24, 24)
    add_donation_lot(distributed_donation_id, item_ids["WATER-1L"], "usable", 60, 45)

    def requirement_id(event_name: str, item_id: int) -> int | None:
        event_id = event_ids.get(event_name)
        if event_id is None:
            return None
        row = db.execute(
            """SELECT id FROM event_logistics_requirements
               WHERE event_id = ? AND inventory_item_id = ? LIMIT 1""",
            (event_id, item_id),
        ).fetchone()
        return row[0] if row else None

    def create_order(
        marker: str,
        *,
        organization_name: str,
        event_name: str,
        order_type: str,
        status: str,
        description: str,
        quantity: float,
        unit: str,
        item_id: int | None,
        requirement: int | None,
        delivery_start: str,
        delivery_end: str,
        collection_start: str | None = None,
        collection_end: str | None = None,
        actual_delivery_at: str | None = None,
    ) -> tuple[int, int] | None:
        existing = db.execute(
            "SELECT id FROM supplier_orders WHERE notes = ?", (marker,)
        ).fetchone()
        if existing is not None:
            line = db.execute(
                "SELECT id FROM supplier_order_lines WHERE supplier_order_id = ? LIMIT 1",
                (existing[0],),
            ).fetchone()
            return (existing[0], line[0]) if line else None
        event_id = event_ids.get(event_name)
        if event_id is None:
            return None
        order_id = db.execute(
            """INSERT INTO supplier_orders
               (organization_id, event_id, order_type, status, delivery_start,
                delivery_end, collection_start, collection_end,
                actual_delivery_at, destination_location_id, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
            (
                organization_ids[organization_name],
                event_id,
                order_type,
                status,
                delivery_start,
                delivery_end,
                collection_start,
                collection_end,
                actual_delivery_at,
                location_id if order_type == "purchase" else None,
                marker,
            ),
        ).fetchone()[0]
        line_id = db.execute(
            """INSERT INTO supplier_order_lines
               (supplier_order_id, requirement_id, inventory_item_id,
                description, quantity, unit)
               VALUES (?, ?, ?, ?, ?, ?) RETURNING id""",
            (order_id, requirement, item_id, description, quantity, unit),
        ).fetchone()[0]
        db.execute(
            "INSERT OR IGNORE INTO event_organizations (event_id, organization_id) VALUES (?, ?)",
            (event_id, organization_ids[organization_name]),
        )
        return order_id, line_id

    purchase = create_order(
        "Demo order: partial water delivery",
        organization_name="CareWell Supplies",
        event_name="Clothes & Essentials Distribution",
        order_type="purchase",
        status="in_progress",
        description="One-litre drinking water",
        quantity=120,
        unit="litre",
        item_id=item_ids["WATER-1L"],
        requirement=requirement_id("Clothes & Essentials Distribution", item_ids["WATER-1L"]),
        delivery_start="2026-08-01 09:00:00",
        delivery_end="2026-08-18 17:00:00",
        actual_delivery_at="2026-08-01 11:15:00",
    )
    rental = create_order(
        "Demo order: folding chair rental",
        organization_name="CareWell Supplies",
        event_name="Zumba at Boon Lay Dormitory",
        order_type="rental",
        status="confirmed",
        description="Folding chair rental",
        quantity=40,
        unit="piece",
        item_id=item_ids["CHAIR-FOLD"],
        requirement=None,
        delivery_start="2026-09-11 14:00:00",
        delivery_end="2026-09-11 17:00:00",
        collection_start="2026-09-12 18:00:00",
        collection_end="2026-09-12 20:00:00",
    )
    service = create_order(
        "Demo order: completed Event transport",
        organization_name="Community Transit",
        event_name="Yoga at Tampines Hub",
        order_type="service",
        status="completed",
        description="Two-way Event transport",
        quantity=1,
        unit="service",
        item_id=None,
        requirement=None,
        delivery_start="2026-06-14 07:00:00",
        delivery_end="2026-06-14 18:00:00",
        actual_delivery_at="2026-06-14 17:45:00",
    )

    if purchase and db.execute(
        "SELECT COUNT(*) FROM supplier_order_fulfilments WHERE supplier_order_id = ?",
        (purchase[0],),
    ).fetchone()[0] == 0:
        fulfilment_id = db.execute(
            """INSERT INTO supplier_order_fulfilments
               (supplier_order_id, line_id, fulfilment_type, quantity, occurred_at, notes)
               VALUES (?, ?, 'receipt', 60, '2026-08-01 11:15:00',
                       'First of two deliveries') RETURNING id""",
            purchase,
        ).fetchone()[0]
        lot_id = db.execute(
            """INSERT INTO inventory_lots
               (item_id, location_id, source_type, source_order_fulfilment_id,
                received_date, condition, current_quantity)
               VALUES (?, ?, 'purchase', ?, '2026-08-01', 'usable', 60) RETURNING id""",
            (item_ids["WATER-1L"], location_id, fulfilment_id),
        ).fetchone()[0]
        db.execute(
            "UPDATE supplier_order_fulfilments SET inventory_lot_id = ? WHERE id = ?",
            (lot_id, fulfilment_id),
        )
        db.execute(
            """INSERT INTO stock_movements
               (item_id, lot_id, location_id, movement_type, quantity_delta, reason)
               VALUES (?, ?, ?, 'receipt', 60, 'Partial Demo Supplier Order receipt')""",
            (item_ids["WATER-1L"], lot_id, location_id),
        )

    if service and db.execute(
        "SELECT COUNT(*) FROM supplier_order_fulfilments WHERE supplier_order_id = ?",
        (service[0],),
    ).fetchone()[0] == 0:
        db.execute(
            """INSERT INTO supplier_order_fulfilments
               (supplier_order_id, line_id, fulfilment_type, quantity, occurred_at, notes)
               VALUES (?, ?, 'service_completion', 1, '2026-06-14 17:45:00',
                       'All passengers returned safely')""",
            service,
        )

    _ = planned_donation_id, rental

    db.commit()


def seed(db) -> None:
    for name, email in [
        ("John Tan", "john.tan@passiontoserve.org"),
        ("Priya Nair", "priya.nair@passiontoserve.org"),
        ("Marcus Lee", "marcus.lee@passiontoserve.org"),
        ("Aisha Rahman", "aisha.rahman@passiontoserve.org"),
    ]:
        db.execute(
            """
            INSERT OR IGNORE INTO team_members (name, email)
            VALUES (?, ?)
            """,
            (name, email),
        )

    seed_logistics(db)

    if db.execute("SELECT COUNT(*) FROM events").fetchone()[0] > 0:
        print("Database already has Events; refreshed safe seed records only.")
        return

    migrant_workers_id = db.execute(
        "SELECT id FROM beneficiaries WHERE name = 'Migrant workers'"
    ).fetchone()[0]

    role_ids = {
        name: db.execute(
            "INSERT INTO roles (name, category) VALUES (?, ?) RETURNING id",
            (name, ROLE_CATEGORY),
        ).fetchone()[0]
        for name in [
            "Wellness Instructor",
            "Setup Crew",
            "Registration",
            "Memory Capture",
            "Sorting Crew",
            "Collection Driver",
            "Warehouse Liaison",
        ]
    }

    skill_ids = {
        name: db.execute(
            "INSERT INTO skills (name) VALUES (?) RETURNING id", (name,)
        ).fetchone()[0]
        for name in [
            "First Aid",
            "Yoga Instruction",
            "Driving (Class 3)",
            "Photography",
            "Mandarin",
            "Tamil",
            "Event Setup",
            "Registration Desk",
        ]
    }

    volunteer_ids = {}
    for name, contact, email, status, skills in [
        ("John Tan", "+65 8123 4567", "john.tan@example.com", "approved", ["First Aid", "Event Setup"]),
        ("Priya Nair", "+65 8234 5678", "priya.nair@example.com", "approved", ["Photography", "Registration Desk"]),
        ("Marcus Lee", "+65 8345 6789", "marcus.lee@example.com", "approved", ["Driving (Class 3)", "Event Setup"]),
        ("Aisha Rahman", "+65 8456 7890", "aisha.rahman@example.com", "approved", ["Registration Desk", "Mandarin"]),
        ("Devi Suresh", "+65 8567 8901", "devi.suresh@example.com", "approved", ["Yoga Instruction", "Tamil"]),
        ("Wei Ming Koh", "+65 8678 9012", "weiming.koh@example.com", "approved", ["Driving (Class 3)"]),
        ("Farah Hassan", "+65 8789 0123", "farah.hassan@example.com", "pending", ["Registration Desk"]),
        ("Ben Ong", "+65 8890 1234", "ben.ong@example.com", "pending", ["Event Setup", "Photography"]),
    ]:
        volunteer_id = db.execute(
            """
            INSERT INTO volunteers (name, contact_number, email, signup_status)
            VALUES (?, ?, ?, ?) RETURNING id
            """,
            (name, contact, email, status),
        ).fetchone()[0]
        volunteer_ids[name] = volunteer_id
        for skill in skills:
            db.execute(
                "INSERT INTO volunteer_skills (volunteer_id, skill_id) VALUES (?, ?)",
                (volunteer_id, skill_ids[skill]),
            )

    wellness_template_id = db.execute(
        """
        INSERT INTO event_templates (name, description, is_built_in, beneficiary_id)
        VALUES (?, ?, 1, ?) RETURNING id
        """,
        ("Wellness – Yoga / Zumba / Meditation", "Run a focused wellbeing session for migrant workers.", migrant_workers_id),
    ).fetchone()[0]
    for role_name in ["Wellness Instructor", "Setup Crew", "Registration", "Memory Capture"]:
        db.execute(
            "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
            (wellness_template_id, role_ids[role_name]),
        )
    wellness_tasks = [
        ("Align the team on holding the event", -56, "planning", None),
        ("Book the event venue", -42, "planning", None),
        ("Confirm the volunteer wellness instructor", -42, "planning", "Wellness Instructor"),
        ("Notify beneficiary migrant workers", -21, "planning", "Registration"),
        ("Set up the audio system", 0, "execution", "Setup Crew"),
        ("Capture event memories", 0, "execution", "Memory Capture"),
        ("Send volunteer acknowledgements", 3, "post_execution", None),
        ("Share the event recap on social media", 7, "post_execution", None),
    ]
    for position, (name, offset, category, role_name) in enumerate(wellness_tasks):
        db.execute(
            """
            INSERT INTO template_tasks
                (event_template_id, name, relative_due_days, category, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (wellness_template_id, name, offset, category, position),
        )

    distribution_template_id = db.execute(
        """
        INSERT INTO event_templates (name, description, is_built_in, beneficiary_id)
        VALUES (?, ?, 1, ?) RETURNING id
        """,
        ("Distribution of pre-loved items", "Collect, sort, and distribute essential items.", migrant_workers_id),
    ).fetchone()[0]
    for role_name in ["Registration", "Sorting Crew", "Collection Driver", "Warehouse Liaison", "Memory Capture"]:
        db.execute(
            "INSERT INTO template_roles (event_template_id, role_id) VALUES (?, ?)",
            (distribution_template_id, role_ids[role_name]),
        )
    distribution_tasks = [
        ("Align the team on holding the event", -56, "planning", None),
        ("Confirm collection venues and schedules", -42, "planning", None),
        ("Arrange collection transport", -35, "planning", "Collection Driver"),
        ("Arrange warehouse storage", -35, "planning", "Warehouse Liaison"),
        ("Notify beneficiary migrant workers", -21, "planning", "Registration"),
        ("Recruit volunteers", -14, "planning", None),
        ("Sort collected items", 0, "execution", "Sorting Crew"),
        ("Capture event memories", 0, "execution", "Memory Capture"),
        ("Send volunteer certificates", 3, "post_execution", None),
        ("Send volunteer acknowledgements", 3, "post_execution", None),
    ]
    for position, (name, offset, category, role_name) in enumerate(distribution_tasks):
        db.execute(
            """
            INSERT INTO template_tasks
                (event_template_id, name, relative_due_days, category, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (distribution_template_id, name, offset, category, position),
        )

    def create_event(template_id: int, template_tasks, name, venue, event_date, status):
        template_description = db.execute(
            "SELECT description FROM event_templates WHERE id = ?", (template_id,)
        ).fetchone()[0]
        event_id = db.execute(
            """
            INSERT INTO events
                (event_template_id, name, venue, event_date, description, status, beneficiary_id)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (template_id, name, venue, event_date.isoformat(), template_description, status, migrant_workers_id),
        ).fetchone()[0]
        task_ids = {}
        for position, (task_name, offset, category, _role_name) in enumerate(template_tasks):
            due_at = (event_date + timedelta(days=offset)).isoformat()
            task_id = db.execute(
                """
                INSERT INTO event_tasks
                    (event_id, name, due_at, category, status, position)
                VALUES (?, ?, ?, ?, 'incomplete', ?)
                RETURNING id
                """,
                (event_id, task_name, due_at, category, position),
            ).fetchone()[0]
            task_ids[task_name] = task_id
        return event_id, task_ids

    def mark_done(task_ids, *names):
        for name in names:
            db.execute("UPDATE event_tasks SET status = 'done' WHERE id = ?", (task_ids[name],))

    def sign_up(event_id, volunteer_name, role_name, status, is_leader=False, attendance=None):
        db.execute(
            """
            INSERT INTO volunteer_signups
                (event_id, volunteer_id, status, assigned_role_id, is_leader, attendance)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                volunteer_ids[volunteer_name],
                status,
                role_ids.get(role_name) if role_name else None,
                1 if is_leader else 0,
                attendance,
            ),
        )

    past_yoga_id, past_yoga_tasks = create_event(
        wellness_template_id, wellness_tasks,
        "Yoga at Tampines Hub", "Tampines Hub", date(2026, 6, 14), "closed",
    )
    mark_done(
        past_yoga_tasks,
        "Align the team on holding the event",
        "Book the event venue",
        "Confirm the volunteer wellness instructor",
        "Notify beneficiary migrant workers",
        "Set up the audio system",
        "Capture event memories",
        "Send volunteer acknowledgements",
    )
    sign_up(past_yoga_id, "Devi Suresh", "Wellness Instructor", "approved", is_leader=True, attendance=True)
    sign_up(past_yoga_id, "John Tan", "Setup Crew", "approved", attendance=True)
    sign_up(past_yoga_id, "Priya Nair", "Memory Capture", "approved", attendance=True)
    sign_up(past_yoga_id, "Farah Hassan", "Registration", "approved", attendance=False)

    zumba_id, zumba_tasks = create_event(
        wellness_template_id, wellness_tasks,
        "Zumba at Boon Lay Dormitory", "Boon Lay Dormitory", date(2026, 9, 12), "open",
    )
    mark_done(zumba_tasks, "Align the team on holding the event", "Confirm the volunteer wellness instructor")
    db.execute(
        "UPDATE event_tasks SET status = 'ongoing' WHERE id = ?", (zumba_tasks["Book the event venue"],)
    )
    sign_up(zumba_id, "Devi Suresh", "Wellness Instructor", "approved", is_leader=True)
    sign_up(zumba_id, "Marcus Lee", "Setup Crew", "requested")
    sign_up(zumba_id, "Ben Ong", "Memory Capture", "requested")
    sign_up(zumba_id, "Wei Ming Koh", None, "rejected")

    distribution_id, distribution_tasks_ids = create_event(
        distribution_template_id, distribution_tasks,
        "Clothes & Essentials Distribution", "Tuas Dormitory", date(2026, 8, 23), "open",
    )
    mark_done(distribution_tasks_ids, "Align the team on holding the event", "Confirm collection venues and schedules")
    sign_up(distribution_id, "John Tan", "Sorting Crew", "approved")
    sign_up(distribution_id, "Marcus Lee", "Collection Driver", "approved")
    sign_up(distribution_id, "Aisha Rahman", "Registration", "approved")
    sign_up(distribution_id, "Farah Hassan", "Warehouse Liaison", "requested")

    for participant_name, contact, email in [
        ("Kumar Selvam", "+65 9111 2222", "kumar.selvam@example.com"),
        ("Rizal Abdullah", "+65 9222 3333", "rizal.abdullah@example.com"),
        ("Htun Aung", "+65 9333 4444", "htun.aung@example.com"),
    ]:
        participant_id = db.execute(
            "INSERT INTO participants (name, contact_number, email) VALUES (?, ?, ?) RETURNING id",
            (participant_name, contact, email),
        ).fetchone()[0]
        for event_id, rsvp, attendance in [
            (past_yoga_id, True, True),
            (zumba_id, True, None),
            (distribution_id, False, None),
        ]:
            db.execute(
                """
                INSERT INTO participations (event_id, participant_id, rsvp_status, attendance)
                VALUES (?, ?, ?, ?)
                """,
                (event_id, participant_id, rsvp, attendance),
            )

    db.commit()
    seed_logistics(db)
    print("Seeded demo data.")


def main() -> None:
    initialize_database(DEFAULT_DATABASE_PATH)
    with connect(DEFAULT_DATABASE_PATH) as db:
        seed(db)


if __name__ == "__main__":
    main()
