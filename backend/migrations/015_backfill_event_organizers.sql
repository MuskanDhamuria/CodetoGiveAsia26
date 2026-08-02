-- Some databases received team-member task assignments after migration 014
-- had already run. Treat those existing assignees as event organisers too.

BEGIN;

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
VALUES (15, '015_backfill_event_organizers.sql');

COMMIT;
