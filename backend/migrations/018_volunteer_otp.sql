PRAGMA foreign_keys = ON;

BEGIN;

-- WhatsApp OTP verification for volunteer accounts. All volunteer signup now
-- happens on the website; the OTP proves the phone number they registered
-- with actually receives WhatsApp messages before we treat them as a fully
-- confirmed volunteer.
ALTER TABLE volunteer_accounts ADD COLUMN phone_verified_at TEXT;
ALTER TABLE volunteer_accounts ADD COLUMN otp_code_hash TEXT;
ALTER TABLE volunteer_accounts ADD COLUMN otp_expires_at TEXT;
ALTER TABLE volunteer_accounts ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (18, '018_volunteer_otp.sql');

COMMIT;
