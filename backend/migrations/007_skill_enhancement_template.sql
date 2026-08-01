-- Keep the built-in plan library aligned with the event-creation prototype.
INSERT OR IGNORE INTO event_templates (name, description, is_built_in, beneficiary_id)
SELECT 'Skill Enhancement',
       'Coordinate a practical learning session for migrant workers.',
       1,
       id
FROM beneficiaries
WHERE name = 'Migrant workers';

INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Align the team on holding the event', -56, 'planning', 0
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Coordinate course administration', -49, 'planning', 1
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Confirm a venue with suitable infrastructure', -42, 'planning', 2
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Notify beneficiary migrant workers', -21, 'planning', 3
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Promote the event on social media', -21, 'planning', 4
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Recruit volunteers', -14, 'planning', 5
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Run the skill-enhancement session', 0, 'execution', 6
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Send volunteer certificates', 3, 'post_execution', 7
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Send volunteer acknowledgements', 3, 'post_execution', 8
FROM event_templates WHERE name = 'Skill Enhancement';
INSERT OR IGNORE INTO template_tasks
    (event_template_id, name, relative_due_days, category, position)
SELECT id, 'Share the event recap on social media', 7, 'post_execution', 9
FROM event_templates WHERE name = 'Skill Enhancement';
