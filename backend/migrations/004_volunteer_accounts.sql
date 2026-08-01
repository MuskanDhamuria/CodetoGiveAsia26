PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS volunteer_accounts (
    id INTEGER PRIMARY KEY,
    volunteer_id INTEGER NOT NULL UNIQUE
        REFERENCES volunteers(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS volunteer_sessions (
    id INTEGER PRIMARY KEY,
    volunteer_account_id INTEGER NOT NULL
        REFERENCES volunteer_accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volunteer_sessions_token_hash
    ON volunteer_sessions(token_hash);

INSERT INTO schema_migrations (version, name)
VALUES (4, '004_volunteer_accounts.sql');

COMMIT;
