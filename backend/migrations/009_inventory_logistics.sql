PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE events ADD COLUMN expected_attendance INTEGER
    CHECK (expected_attendance IS NULL OR expected_attendance >= 0);

-- A short-lived legacy Event rebuild could remove this child table while its
-- migration version remained recorded. Restore it before promoting names.
CREATE TABLE IF NOT EXISTS event_partners (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (event_id, name)
);
CREATE INDEX IF NOT EXISTS idx_event_partners_event ON event_partners(event_id);

CREATE TABLE external_organizations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name)
);

CREATE TABLE organization_capabilities (
    organization_id INTEGER NOT NULL
        REFERENCES external_organizations(id) ON DELETE CASCADE,
    capability TEXT NOT NULL CHECK (capability IN (
        'supplier', 'donor', 'transport_provider', 'venue_partner', 'ngo',
        'government_agency', 'dormitory', 'education_provider'
    )),
    PRIMARY KEY (organization_id, capability)
);

CREATE TABLE organization_contacts (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL
        REFERENCES external_organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    role TEXT NOT NULL DEFAULT '',
    email TEXT COLLATE NOCASE,
    phone TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX one_primary_contact_per_organization
    ON organization_contacts(organization_id) WHERE is_primary = 1 AND is_active = 1;

CREATE TABLE event_organizations (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL
        REFERENCES external_organizations(id) ON DELETE RESTRICT,
    relationship_notes TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (event_id, organization_id)
);

-- Preserve the original name-only partner records while establishing reusable
-- organization identities. The legacy table remains as a report compatibility view.
INSERT OR IGNORE INTO external_organizations (name)
SELECT trim(name) FROM event_partners GROUP BY lower(trim(name));

INSERT OR IGNORE INTO event_organizations (event_id, organization_id)
SELECT event_partners.event_id, external_organizations.id
FROM event_partners
JOIN external_organizations
  ON lower(external_organizations.name) = lower(trim(event_partners.name));

CREATE TABLE venues (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    address TEXT NOT NULL DEFAULT '',
    managing_organization_id INTEGER
        REFERENCES external_organizations(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE venue_spaces (
    id INTEGER PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    pax_capacity INTEGER CHECK (pax_capacity IS NULL OR pax_capacity >= 0),
    accessibility_information TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (venue_id, name)
);

CREATE TABLE event_venue_bookings (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    venue_space_id INTEGER NOT NULL REFERENCES venue_spaces(id) ON DELETE RESTRICT,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'tentative'
        CHECK (status IN ('tentative', 'confirmed', 'cancelled', 'completed')),
    start_at TEXT NOT NULL CHECK (datetime(start_at) IS NOT NULL),
    end_at TEXT NOT NULL CHECK (datetime(end_at) IS NOT NULL),
    cost_sgd_cents INTEGER CHECK (cost_sgd_cents IS NULL OR cost_sgd_cents >= 0),
    contact_id INTEGER REFERENCES organization_contacts(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (datetime(end_at) > datetime(start_at))
);

CREATE UNIQUE INDEX one_primary_booking_per_event
    ON event_venue_bookings(event_id) WHERE is_primary = 1 AND status != 'cancelled';

CREATE TABLE inventory_items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    sku TEXT COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
    item_type TEXT NOT NULL CHECK (item_type IN ('consumable', 'reusable')),
    reorder_level REAL NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sku)
);

CREATE TABLE inventory_locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    address TEXT NOT NULL DEFAULT '',
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    venue_space_id INTEGER REFERENCES venue_spaces(id) ON DELETE SET NULL,
    is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE donation_batches (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    source_organization_id INTEGER
        REFERENCES external_organizations(id) ON DELETE SET NULL,
    collection_at TEXT,
    received_at TEXT,
    sorting_completed_at TEXT,
    distribution_at TEXT,
    container_count REAL CHECK (container_count IS NULL OR container_count >= 0),
    container_unit TEXT,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'collected', 'received', 'sorting', 'sorted', 'distributed', 'closed', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_orders (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL
        REFERENCES external_organizations(id) ON DELETE RESTRICT,
    contact_id INTEGER REFERENCES organization_contacts(id) ON DELETE SET NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    order_type TEXT NOT NULL CHECK (order_type IN ('purchase', 'rental', 'service')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'in_progress', 'completed', 'cancelled')),
    fees_sgd_cents INTEGER CHECK (fees_sgd_cents IS NULL OR fees_sgd_cents >= 0),
    delivery_start TEXT,
    delivery_end TEXT,
    collection_start TEXT,
    collection_end TEXT,
    actual_delivery_at TEXT,
    actual_collection_at TEXT,
    destination_location_id INTEGER
        REFERENCES inventory_locations(id) ON DELETE SET NULL,
    destination_text TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE template_logistics_requirements (
    id INTEGER PRIMARY KEY,
    event_template_id INTEGER NOT NULL
        REFERENCES event_templates(id) ON DELETE CASCADE,
    requirement_type TEXT NOT NULL CHECK (requirement_type IN ('goods', 'service')),
    inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE RESTRICT,
    service_name TEXT,
    base_quantity REAL NOT NULL DEFAULT 0 CHECK (base_quantity >= 0),
    quantity_per_person REAL NOT NULL DEFAULT 0 CHECK (quantity_per_person >= 0),
    buffer_percentage REAL NOT NULL DEFAULT 0 CHECK (buffer_percentage >= 0),
    unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
    relative_needed_day INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((requirement_type = 'goods' AND inventory_item_id IS NOT NULL AND service_name IS NULL)
        OR (requirement_type = 'service' AND inventory_item_id IS NULL AND length(trim(service_name)) > 0))
);

CREATE TABLE event_logistics_requirements (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    template_requirement_id INTEGER
        REFERENCES template_logistics_requirements(id) ON DELETE SET NULL,
    requirement_type TEXT NOT NULL CHECK (requirement_type IN ('goods', 'service')),
    inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE RESTRICT,
    service_name TEXT,
    base_quantity REAL NOT NULL DEFAULT 0 CHECK (base_quantity >= 0),
    quantity_per_person REAL NOT NULL DEFAULT 0 CHECK (quantity_per_person >= 0),
    buffer_percentage REAL NOT NULL DEFAULT 0 CHECK (buffer_percentage >= 0),
    expected_attendance_snapshot INTEGER CHECK (expected_attendance_snapshot IS NULL OR expected_attendance_snapshot >= 0),
    required_quantity REAL NOT NULL CHECK (required_quantity >= 0),
    unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
    needed_by TEXT NOT NULL CHECK (datetime(needed_by) IS NOT NULL),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    notes TEXT NOT NULL DEFAULT '',
    is_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (is_cancelled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((requirement_type = 'goods' AND inventory_item_id IS NOT NULL AND service_name IS NULL)
        OR (requirement_type = 'service' AND inventory_item_id IS NULL AND length(trim(service_name)) > 0))
);

CREATE TABLE supplier_order_lines (
    id INTEGER PRIMARY KEY,
    supplier_order_id INTEGER NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
    requirement_id INTEGER REFERENCES event_logistics_requirements(id) ON DELETE SET NULL,
    inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE RESTRICT,
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
    unit_cost_sgd_cents INTEGER CHECK (unit_cost_sgd_cents IS NULL OR unit_cost_sgd_cents >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_order_fulfilments (
    id INTEGER PRIMARY KEY,
    supplier_order_id INTEGER NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
    line_id INTEGER REFERENCES supplier_order_lines(id) ON DELETE SET NULL,
    fulfilment_type TEXT NOT NULL CHECK (fulfilment_type IN ('receipt', 'delivery', 'return', 'service_completion')),
    quantity REAL CHECK (quantity IS NULL OR quantity > 0),
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    inventory_lot_id INTEGER REFERENCES inventory_lots(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_lots (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    location_id INTEGER NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    source_type TEXT NOT NULL DEFAULT 'adjustment'
        CHECK (source_type IN ('purchase', 'donation', 'adjustment', 'transfer', 'return')),
    source_order_fulfilment_id INTEGER
        REFERENCES supplier_order_fulfilments(id) ON DELETE SET NULL,
    donation_batch_id INTEGER REFERENCES donation_batches(id) ON DELETE SET NULL,
    received_date TEXT NOT NULL DEFAULT (date('now')),
    expiry_date TEXT,
    condition TEXT NOT NULL DEFAULT 'usable'
        CHECK (condition IN ('pending_sort', 'usable', 'damaged', 'expired', 'discarded')),
    current_quantity REAL NOT NULL CHECK (current_quantity >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE event_logistics_reconciliations (
    event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'pending', 'completed')),
    completed_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_allocations (
    id INTEGER PRIMARY KEY,
    requirement_id INTEGER NOT NULL
        REFERENCES event_logistics_requirements(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    source_location_id INTEGER NOT NULL
        REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    reserved_quantity REAL NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    issued_quantity REAL NOT NULL DEFAULT 0 CHECK (issued_quantity >= 0),
    returned_quantity REAL NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
    consumed_quantity REAL NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
    damaged_quantity REAL NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
    lost_quantity REAL NOT NULL DEFAULT 0 CHECK (lost_quantity >= 0),
    distributed_quantity REAL NOT NULL DEFAULT 0 CHECK (distributed_quantity >= 0),
    status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'issued', 'reconciled', 'released')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    lot_id INTEGER REFERENCES inventory_lots(id) ON DELETE SET NULL,
    location_id INTEGER NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    destination_location_id INTEGER REFERENCES inventory_locations(id) ON DELETE SET NULL,
    allocation_id INTEGER REFERENCES inventory_allocations(id) ON DELETE SET NULL,
    donation_batch_id INTEGER REFERENCES donation_batches(id) ON DELETE SET NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'receipt', 'transfer_out', 'transfer_in', 'issue', 'return', 'consumption',
        'damage', 'loss', 'distribution', 'disposal', 'adjustment'
    )),
    quantity_delta REAL NOT NULL CHECK (quantity_delta != 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    group_reference TEXT,
    actor_team_member_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inventory_lots_item_location ON inventory_lots(item_id, location_id);
CREATE INDEX idx_stock_movements_item_created ON stock_movements(item_id, created_at);
CREATE INDEX idx_allocations_requirement ON inventory_allocations(requirement_id);
CREATE INDEX idx_event_requirements_event ON event_logistics_requirements(event_id);
CREATE INDEX idx_supplier_orders_event ON supplier_orders(event_id);
CREATE INDEX idx_bookings_space_time ON event_venue_bookings(venue_space_id, start_at, end_at);

INSERT INTO schema_migrations (version, name)
VALUES (9, 'inventory and logistics management');

COMMIT;
