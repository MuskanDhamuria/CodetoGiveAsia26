-- Snapshot template roles onto each event so organizers can customise one
-- event without changing every event that shares the same template.

BEGIN;

CREATE TABLE IF NOT EXISTS event_roles (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, role_id)
);

INSERT OR IGNORE INTO event_roles (event_id, role_id)
SELECT events.id, template_roles.role_id
FROM events
JOIN template_roles
  ON template_roles.event_template_id = events.event_template_id;

CREATE INDEX IF NOT EXISTS idx_event_roles_role ON event_roles(role_id);

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (9, '009_event_roles.sql');

COMMIT;
