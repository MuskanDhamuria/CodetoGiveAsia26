PRAGMA foreign_keys = ON;

BEGIN;

-- Participant-facing instructions for an event (e.g. "bring a water bottle"),
-- shown on the event detail page. Nullable: existing events have none yet.
ALTER TABLE events ADD COLUMN description TEXT;

-- Time of day the event starts, kept separate from event_date so existing
-- date-only filtering/sorting is unaffected. "HH:MM" or "HH:MM:SS".
ALTER TABLE events ADD COLUMN event_time TEXT NOT NULL
    CHECK (time(event_time) IS NOT NULL);

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (2, 'add_event_description_and_time');

COMMIT;
