PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

BEGIN;

ALTER TABLE events RENAME TO events_before_optional_template;

CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    event_template_id INTEGER
        REFERENCES event_templates(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    venue TEXT NOT NULL CHECK (length(trim(venue)) > 0),
    event_date TEXT NOT NULL
        CHECK (date(event_date) IS NOT NULL AND event_date = date(event_date)),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    beneficiary_id INTEGER REFERENCES beneficiaries(id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '',
    start_time TEXT,
    end_time TEXT
);

INSERT INTO events
    (id, event_template_id, name, venue, event_date, status,
     created_at, updated_at, beneficiary_id, description, start_time, end_time)
SELECT id, event_template_id, name, venue, event_date, status,
       created_at, updated_at, beneficiary_id, description, start_time, end_time
FROM events_before_optional_template;

DROP TABLE events_before_optional_template;

CREATE INDEX idx_events_event_date ON events(event_date);
CREATE INDEX idx_events_beneficiary ON events(beneficiary_id);

CREATE TRIGGER events_set_updated_at
AFTER UPDATE ON events
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (6, '006_optional_event_template.sql');

COMMIT;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
