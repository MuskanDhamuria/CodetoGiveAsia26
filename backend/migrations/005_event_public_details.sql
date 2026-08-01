PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE events ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN start_time TEXT;
ALTER TABLE events ADD COLUMN end_time TEXT;

UPDATE events
SET description = COALESCE(
    (
        SELECT description FROM event_templates
        WHERE event_templates.id = events.event_template_id
    ),
    ''
)
WHERE description = '';

INSERT INTO schema_migrations (version, name)
VALUES (5, '005_event_public_details.sql');

COMMIT;
