PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    contact_number TEXT,
    email TEXT COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (contact_number),
    UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS volunteers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    contact_number TEXT,
    email TEXT COLLATE NOCASE,
    signup_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (signup_status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (contact_number),
    UNIQUE (email)
);

-- Skills are normalized because a volunteer can have many skills and a skill
-- can be used to match many volunteers to tasks.
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS volunteer_skills (
    volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (volunteer_id, skill_id)
);

CREATE TABLE IF NOT EXISTS event_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    is_built_in INTEGER NOT NULL DEFAULT 0 CHECK (is_built_in IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    category TEXT NOT NULL DEFAULT '',
    is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
    UNIQUE (name, category)
);

CREATE TABLE IF NOT EXISTS template_roles (
    id INTEGER PRIMARY KEY,
    event_template_id INTEGER NOT NULL
        REFERENCES event_templates(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    UNIQUE (event_template_id, role_id)
);

CREATE TABLE IF NOT EXISTS volunteer_interests (
    volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    is_lead INTEGER NOT NULL DEFAULT 0 CHECK (is_lead IN (0, 1)),
    PRIMARY KEY (volunteer_id, role_id)
);

CREATE TABLE IF NOT EXISTS template_tasks (
    id INTEGER PRIMARY KEY,
    event_template_id INTEGER NOT NULL
        REFERENCES event_templates(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    body TEXT NOT NULL DEFAULT '',
    relative_due_days INTEGER NOT NULL,
    category TEXT NOT NULL
        CHECK (category IN ('planning', 'execution', 'post_execution')),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (event_template_id, position)
);

CREATE TABLE IF NOT EXISTS template_subtasks (
    id INTEGER PRIMARY KEY,
    template_task_id INTEGER NOT NULL
        REFERENCES template_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (template_task_id, position)
);

CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    email TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(email)) > 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    event_template_id INTEGER NOT NULL
        REFERENCES event_templates(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    venue TEXT NOT NULL CHECK (length(trim(venue)) > 0),
    event_date TEXT NOT NULL
        CHECK (date(event_date) IS NOT NULL AND event_date = date(event_date)),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_tasks (
    id INTEGER PRIMARY KEY,
    team_member_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    template_task_id INTEGER REFERENCES template_tasks(id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    body TEXT NOT NULL DEFAULT '',
    due_at TEXT NOT NULL CHECK (datetime(due_at) IS NOT NULL),
    category TEXT NOT NULL
        CHECK (category IN ('planning', 'execution', 'post_execution')),
    status TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (status IN ('incomplete', 'ongoing', 'done')),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (event_id, position)
);

CREATE TABLE IF NOT EXISTS event_subtasks (
    id INTEGER PRIMARY KEY,
    event_task_id INTEGER NOT NULL REFERENCES event_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    UNIQUE (event_task_id, position)
);

CREATE TABLE IF NOT EXISTS participations (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    rsvp_status INTEGER NOT NULL DEFAULT 0 CHECK (rsvp_status IN (0, 1)),
    attendance INTEGER CHECK (attendance IN (0, 1)),
    UNIQUE (event_id, participant_id)
);

CREATE TABLE IF NOT EXISTS volunteer_signups (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected')),
    assigned_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    is_leader INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0, 1)),
    attendance INTEGER CHECK (attendance IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, volunteer_id)
);

CREATE TABLE IF NOT EXISTS volunteer_signup_role_preferences (
    signup_id INTEGER NOT NULL REFERENCES volunteer_signups(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    priority INTEGER CHECK (priority IS NULL OR priority > 0),
    PRIMARY KEY (signup_id, role_id),
    UNIQUE (signup_id, priority)
);

CREATE TABLE IF NOT EXISTS event_partners (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS event_reports (
    event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (status IN ('incomplete', 'complete')),
    generated_caption TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_photo_captions (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
    caption TEXT NOT NULL DEFAULT '',
    alt_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_event_tasks_event_due_at ON event_tasks(event_id, due_at);
CREATE INDEX IF NOT EXISTS idx_event_tasks_assignee ON event_tasks(team_member_id);
CREATE INDEX IF NOT EXISTS idx_participations_participant ON participations(participant_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_volunteer ON volunteer_signups(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_event_status
    ON volunteer_signups(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_partners_event ON event_partners(event_id);
CREATE INDEX IF NOT EXISTS idx_report_photo_captions_event
    ON report_photo_captions(event_id);

-- SQLite has no automatic ON UPDATE timestamp clause, so keep mutable records'
-- updated_at fields accurate with small per-table triggers.
CREATE TRIGGER IF NOT EXISTS participants_set_updated_at
AFTER UPDATE ON participants
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE participants SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS volunteers_set_updated_at
AFTER UPDATE ON volunteers
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE volunteers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS event_templates_set_updated_at
AFTER UPDATE ON event_templates
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE event_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS team_members_set_updated_at
AFTER UPDATE ON team_members
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE team_members SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS events_set_updated_at
AFTER UPDATE ON events
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS volunteer_signups_set_updated_at
AFTER UPDATE ON volunteer_signups
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE volunteer_signups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS event_reports_set_updated_at
AFTER UPDATE ON event_reports
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE event_reports SET updated_at = CURRENT_TIMESTAMP WHERE event_id = NEW.event_id;
END;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (1, 'initial_schema');

COMMIT;
