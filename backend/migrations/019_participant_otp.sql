PRAGMA foreign_keys = ON;

BEGIN;

-- WhatsApp OTP verification for participants who sign up through the
-- website's "Create account" form (POST /public/signup). Mirrors
-- volunteer_accounts' OTP columns from migration 018, but lives directly on
-- participants since participants have no separate account/session table —
-- see backend/api/routes/public.py.
ALTER TABLE participants ADD COLUMN phone_verified_at TEXT;
ALTER TABLE participants ADD COLUMN otp_code_hash TEXT;
ALTER TABLE participants ADD COLUMN otp_expires_at TEXT;
ALTER TABLE participants ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;
-- Hash of a one-time opaque token returned alongside participant_id from
-- /public/signup. Verify-otp requires this token (not just participant_id +
-- code) so a stranger can't brute-force another participant's OTP just by
-- knowing/guessing their id.
ALTER TABLE participants ADD COLUMN otp_verify_token_hash TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (19, '019_participant_otp.sql');

COMMIT;
