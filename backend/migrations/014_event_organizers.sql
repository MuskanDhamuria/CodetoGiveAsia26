-- Event-specific organisers may be PTS staff, approved volunteers, or a
-- person represented in both directories. Tasks can also be assigned to an
-- approved volunteer without promoting them to organiser.

BEGIN;

ALTER TABLE event_tasks
ADD COLUMN volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_tasks_volunteer
ON event_tasks(volunteer_id);

CREATE TABLE IF NOT EXISTS event_organizers (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
    volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (team_member_id IS NOT NULL OR volunteer_id IS NOT NULL),
    UNIQUE (event_id, team_member_id),
    UNIQUE (event_id, volunteer_id)
);

CREATE INDEX IF NOT EXISTS idx_event_organizers_event
ON event_organizers(event_id);

-- Existing task assignees were already acting as organisers for that event.
INSERT OR IGNORE INTO event_organizers (event_id, team_member_id, volunteer_id)
SELECT DISTINCT tasks.event_id, tasks.team_member_id,
       (
           SELECT volunteers.id
           FROM volunteers
           JOIN volunteer_signups
             ON volunteer_signups.volunteer_id = volunteers.id
            AND volunteer_signups.event_id = tasks.event_id
            AND volunteer_signups.status = 'approved'
           JOIN team_members
             ON team_members.id = tasks.team_member_id
            AND lower(trim(volunteers.email)) = lower(trim(team_members.email))
           LIMIT 1
       )
FROM event_tasks AS tasks
WHERE tasks.team_member_id IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (14, '014_event_organizers.sql');

COMMIT;
