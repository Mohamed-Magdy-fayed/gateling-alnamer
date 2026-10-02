-- Data migration (hand-written by design): student-facing public numbers.
-- Numbers every existing user as AN + 6 digits in created_at, id order starting at AN100001,
-- then creates user_public_number_seq positioned after the last assigned number.
-- Idempotent: only rows with a null public_number are numbered, continuing after the highest used.
CREATE SEQUENCE IF NOT EXISTS user_public_number_seq START 100001;
--> statement-breakpoint
WITH base AS (
  SELECT COALESCE(MAX(substring("public_number" FROM 3)::bigint), 100000) AS last_used
  FROM "users" WHERE "public_number" ~ '^AN[0-9]+$'
),
ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "users" WHERE "public_number" IS NULL
)
UPDATE "users" u
SET "public_number" = 'AN' || (base.last_used + ordered.rn)
FROM ordered, base
WHERE u."id" = ordered."id";
--> statement-breakpoint
SELECT setval(
  'user_public_number_seq',
  GREATEST(
    100000,
    COALESCE((SELECT MAX(substring("public_number" FROM 3)::bigint) FROM "users" WHERE "public_number" ~ '^AN[0-9]+$'), 100000)
  )
);
