-- Keep the built-in plan library aligned with the event-creation prototype.
-- This migration also repairs databases created by the first version of this
-- migration, which could insert the same built-in template repeatedly.
BEGIN;

-- Keep the lowest id as the canonical template and move any existing Events
-- before removing duplicate templates. Template Tasks/Roles cascade away from
-- the duplicate; the canonical template is populated below if needed.
UPDATE events
SET event_template_id = (
    SELECT MIN(id)
    FROM event_templates
    WHERE name = 'Skill Enhancement' AND is_built_in = 1
)
WHERE event_template_id IN (
    SELECT id
    FROM event_templates
    WHERE name = 'Skill Enhancement' AND is_built_in = 1
      AND id <> (
          SELECT MIN(id)
          FROM event_templates
          WHERE name = 'Skill Enhancement' AND is_built_in = 1
      )
);

DELETE FROM event_templates
WHERE name = 'Skill Enhancement'
  AND is_built_in = 1
  AND id <> (
      SELECT MIN(id)
      FROM event_templates
      WHERE name = 'Skill Enhancement' AND is_built_in = 1
  );

INSERT INTO event_templates (name, description, is_built_in, beneficiary_id)
SELECT 'Skill Enhancement',
       'Coordinate a practical learning session for migrant workers.',
       1,
       id
FROM beneficiaries
WHERE name = 'Migrant workers'
  AND NOT EXISTS (
      SELECT 1
      FROM event_templates
      WHERE name = 'Skill Enhancement' AND is_built_in = 1
  );

INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Align the team on holding the event', -56, 'planning', 0
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Coordinate course administration', -49, 'planning', 1
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Confirm a venue with suitable infrastructure', -42, 'planning', 2
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Notify beneficiary migrant workers', -21, 'planning', 3
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Promote the event on social media', -21, 'planning', 4
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Recruit volunteers', -14, 'planning', 5
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Run the skill-enhancement session', 0, 'execution', 6
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Send volunteer certificates', 3, 'post_execution', 7
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Send volunteer acknowledgements', 3, 'post_execution', 8
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Share the event recap on social media', 7, 'post_execution', 9
FROM event_templates WHERE name = 'Skill Enhancement' AND is_built_in = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_builtin_event_templates_name
    ON event_templates(name)
    WHERE is_built_in = 1;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (7, '007_skill_enhancement_template.sql');

COMMIT;
