PRAGMA foreign_keys = ON;

BEGIN;

-- One row per WhatsApp phone number that has ever messaged the bot or been
-- added by an organizer. A contact may be linked to a participant, a
-- volunteer, and/or a team member; the bot's available commands depend on
-- which links are set. conversation_state holds small JSON used for simple
-- multi-step flows (for example, "waiting for a name to finish signup").
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
    id INTEGER PRIMARY KEY,
    phone_number TEXT NOT NULL UNIQUE,
    display_name TEXT,
    participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
    volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE SET NULL,
    team_member_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
    notify_new_events INTEGER NOT NULL DEFAULT 1 CHECK (notify_new_events IN (0, 1)),
    conversation_state TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Inbound/outbound message log, mainly for debugging and delivery audits.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    wa_message_id TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact
    ON whatsapp_messages(contact_id);

-- Organizer-authored announcements/reminders. audience selects who the
-- broadcast goes to; event_id is required unless audience = 'all'.
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    audience TEXT NOT NULL DEFAULT 'all'
        CHECK (audience IN ('all', 'participants', 'volunteers')),
    kind TEXT NOT NULL DEFAULT 'announcement'
        CHECK (kind IN ('announcement', 'reminder')),
    created_by_team_member_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
);

CREATE TABLE IF NOT EXISTS announcement_deliveries (
    id INTEGER PRIMARY KEY,
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    whatsapp_contact_id INTEGER NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    error TEXT,
    sent_at TEXT,
    UNIQUE (announcement_id, whatsapp_contact_id)
);

-- One certificate per (event, participant) or (event, volunteer). Delivered
-- as a link to a printable certificate page rather than a stored binary file.
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
    volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE CASCADE,
    download_token TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TEXT,
    CHECK (
        (participant_id IS NOT NULL AND volunteer_id IS NULL)
        OR (participant_id IS NULL AND volunteer_id IS NOT NULL)
    ),
    UNIQUE (event_id, participant_id),
    UNIQUE (event_id, volunteer_id)
);

-- volunteer_signups.confirmed_at (lets a volunteer confirm a task/role
-- assignment from the bot) is added by database.py before this script runs,
-- not here — SQLite has no "ADD COLUMN IF NOT EXISTS", and some databases
-- already have this column from the version this migration was briefly
-- numbered 007 before it was renumbered to avoid colliding with
-- 007_skill_enhancement_template.sql.

INSERT INTO schema_migrations (version, name)
VALUES (8, '008_whatsapp_bot.sql');

COMMIT;
