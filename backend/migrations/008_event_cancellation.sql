PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE events ADD COLUMN cancelled_at TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (8, '008_event_cancellation.sql');

COMMIT;
