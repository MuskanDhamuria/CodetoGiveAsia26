-- A task may be shared by multiple PTS staff and approved volunteers.

BEGIN;

CREATE TABLE IF NOT EXISTS event_task_assignees (
    id INTEGER PRIMARY KEY,
    event_task_id INTEGER NOT NULL REFERENCES event_tasks(id) ON DELETE CASCADE,
    team_member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
    volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE CASCADE,
    is_lead INTEGER NOT NULL DEFAULT 0 CHECK (is_lead IN (0, 1)),
    CHECK (
        (team_member_id IS NOT NULL AND volunteer_id IS NULL)
        OR (team_member_id IS NULL AND volunteer_id IS NOT NULL)
    ),
    UNIQUE (event_task_id, team_member_id),
    UNIQUE (event_task_id, volunteer_id)
);

CREATE INDEX IF NOT EXISTS idx_event_task_assignees_task
ON event_task_assignees(event_task_id);

INSERT OR IGNORE INTO event_task_assignees (event_task_id, team_member_id)
SELECT id, team_member_id FROM event_tasks WHERE team_member_id IS NOT NULL;

INSERT OR IGNORE INTO event_task_assignees (event_task_id, volunteer_id)
SELECT id, volunteer_id FROM event_tasks WHERE volunteer_id IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (16, '016_event_task_assignees.sql');

COMMIT;
