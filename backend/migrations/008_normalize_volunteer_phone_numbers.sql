-- Store volunteer phone numbers consistently in E.164-style compact form.
-- New writes are validated by backend.phone; this migration cleans the
-- spacing and punctuation used by older seed data and existing databases.
BEGIN;

WITH compact_numbers AS (
    SELECT id,
           REPLACE(
             REPLACE(
               REPLACE(
                 REPLACE(
                   REPLACE(TRIM(contact_number), ' ', ''),
                   '-', ''
                 ),
                 '(', ''
               ),
               ')', ''
             ),
             '.', ''
           ) AS compact
    FROM volunteers
    WHERE contact_number IS NOT NULL AND TRIM(contact_number) <> ''
), canonical_numbers AS (
    SELECT id,
           CASE
             WHEN SUBSTR(compact, 1, 1) = '+' THEN compact
             ELSE '+65' || compact
           END AS canonical
    FROM compact_numbers
), unique_numbers AS (
    SELECT canonical
    FROM canonical_numbers
    GROUP BY canonical
    HAVING COUNT(*) = 1
)
UPDATE volunteers
SET contact_number = (
    SELECT canonical FROM canonical_numbers WHERE canonical_numbers.id = volunteers.id
)
WHERE id IN (
    SELECT canonical_numbers.id
    FROM canonical_numbers
    JOIN unique_numbers USING (canonical)
);

INSERT OR IGNORE INTO schema_migrations (version, name)
VALUES (8, '008_normalize_volunteer_phone_numbers.sql');

COMMIT;
