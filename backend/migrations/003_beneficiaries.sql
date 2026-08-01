PRAGMA foreign_keys = ON;

BEGIN;

-- Open-ended lookup table (same shape as roles/skills) so organisers can add
-- new beneficiary groups later without a schema change.
CREATE TABLE IF NOT EXISTS beneficiaries (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    UNIQUE (name)
);

-- A template's default beneficiary; each event copies this in at creation
-- and may be edited independently afterwards.
ALTER TABLE event_templates ADD COLUMN beneficiary_id INTEGER
    REFERENCES beneficiaries(id) ON DELETE SET NULL;

ALTER TABLE events ADD COLUMN beneficiary_id INTEGER
    REFERENCES beneficiaries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_templates_beneficiary
    ON event_templates(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_events_beneficiary ON events(beneficiary_id);

INSERT OR IGNORE INTO beneficiaries (name) VALUES
    ('Migrant workers'),
    ('Low income households'),
    ('Elderly'),
    ('Patients / healthcare / special needs'),
    ('Inmates');

-- Every template and event predating this migration is a migrant-worker
-- program; backfill them so nothing is left unclassified.
UPDATE event_templates
SET beneficiary_id = (SELECT id FROM beneficiaries WHERE name = 'Migrant workers')
WHERE beneficiary_id IS NULL;

UPDATE events
SET beneficiary_id = (SELECT id FROM beneficiaries WHERE name = 'Migrant workers')
WHERE beneficiary_id IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (3, 'beneficiaries');

COMMIT;
