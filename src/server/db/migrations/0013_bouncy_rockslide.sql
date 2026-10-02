ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE "citext";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" "citext";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("users"."username" IS NULL OR (char_length("users"."username") BETWEEN 3 AND 20 AND lower("users"."username"::text) ~ '^[a-z0-9_.]+$'));