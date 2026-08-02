-- Subtasks may represent either scheduled shifts or effort-based pieces of work.
-- Each subtask can have several PTS staff / approved-volunteer assignees and
-- can collect individual time logs without changing existing checklist data.

BEGIN;

ALTER TABLE event_subtasks ADD COLUMN scheduled_start TEXT;
ALTER TABLE event_subtasks ADD COLUMN scheduled_end TEXT;
ALTER TABLE event_subtasks ADD COLUMN estimated_minutes INTEGER
    CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0);

CREATE TABLE IF NOT EXISTS event_subtask_assignees (
    id INTEGER PRIMARY KEY,
    event_subtask_id INTEGER NOT NULL REFERENCES event_subtasks(id) ON DELETE CASCADE,
    team_member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
    volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE CASCADE,
    CHECK (
        (team_member_id IS NOT NULL AND volunteer_id IS NULL)
        OR (team_member_id IS NULL AND volunteer_id IS NOT NULL)
    ),
    UNIQUE (event_subtask_id, team_member_id),
    UNIQUE (event_subtask_id, volunteer_id)
);

CREATE INDEX IF NOT EXISTS idx_event_subtask_assignees_subtask
ON event_subtask_assignees(event_subtask_id);

CREATE TABLE IF NOT EXISTS event_subtask_time_logs (
    id INTEGER PRIMARY KEY,
    event_subtask_id INTEGER NOT NULL REFERENCES event_subtasks(id) ON DELETE CASCADE,
    team_member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
    volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE CASCADE,
    minutes_spent INTEGER NOT NULL CHECK (minutes_spent > 0),
    notes TEXT NOT NULL DEFAULT '',
    logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (team_member_id IS NOT NULL AND volunteer_id IS NULL)
        OR (team_member_id IS NULL AND volunteer_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_event_subtask_time_logs_subtask
ON event_subtask_time_logs(event_subtask_id);

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (17, '017_event_subtask_work.sql');

COMMIT;
