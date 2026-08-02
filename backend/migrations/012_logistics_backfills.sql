BEGIN;

CREATE TABLE event_logistics_backfills (
    id INTEGER PRIMARY KEY,
    requirement_id INTEGER NOT NULL REFERENCES event_logistics_requirements(id) ON DELETE CASCADE,
    quantity REAL NOT NULL CHECK (quantity > 0),
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logistics_backfills_requirement ON event_logistics_backfills(requirement_id);

INSERT INTO schema_migrations (version, name)
VALUES (12, 'event logistics backfills');

COMMIT;
