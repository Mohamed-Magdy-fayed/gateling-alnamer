-- Data migration (hand-written by design): runs BEFORE the email column becomes citext.
-- 1. Enables citext.
-- 2. Fails loudly if two users' emails differ only by case (reports a count, never an address).
-- 3. Lower-cases every stored email that has upper-case characters.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
DO $$
DECLARE
  collisions integer;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT lower("email") FROM "users" WHERE "email" IS NOT NULL GROUP BY 1 HAVING count(*) > 1
  ) g;
  IF collisions > 0 THEN
    RAISE EXCEPTION 'citext pre-step: % email group(s) differ only by case; resolve them before migrating', collisions;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
