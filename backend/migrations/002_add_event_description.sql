PRAGMA foreign_keys = ON;

BEGIN;

-- Participant-facing instructions for an event (e.g. "bring a water bottle"),
-- shown on the event detail page. Nullable: existing events have none yet.
ALTER TABLE events ADD COLUMN description TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (2, 'add_event_description');

COMMIT;
