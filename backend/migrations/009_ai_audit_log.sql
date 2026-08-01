PRAGMA foreign_keys = ON;

BEGIN;

-- Audit trail for AI-generated mutations (TICKET-4). Logs every tool
-- dispatch, success or failure — there is no acting-user column since the
-- admin backend has no auth/user concept yet (see TICKET-0's decision);
-- add one later if admin auth ever gets built.
CREATE TABLE IF NOT EXISTS ai_audit_log (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tool_name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    entity_id INTEGER,
    reason TEXT
);

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (9, '009_ai_audit_log.sql');

COMMIT;
