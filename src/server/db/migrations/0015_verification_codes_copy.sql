-- Data migration (hand-written by design): expand step of verification_codes.
-- 1. Copies live password_reset_codes (unconsumed, unexpired) as password_reset codes, status sent.
--    Their hashes use the old email-based scheme, so they cannot be verified; users re-request.
-- 2. Existing users with an email count as verified (the demo's users cannot be forced to re-verify).
INSERT INTO "verification_codes" ("user_id", "purpose", "code_hash", "attempts", "expires_at", "email_status", "email_sent_at", "created_at")
SELECT "user_id", 'password_reset', "code_hash", "attempts", "expires_at", 'sent', "created_at", "created_at"
FROM "password_reset_codes"
WHERE "consumed_at" IS NULL AND "expires_at" > now();
--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = "created_at"
WHERE "email" IS NOT NULL AND "email_verified_at" IS NULL;
