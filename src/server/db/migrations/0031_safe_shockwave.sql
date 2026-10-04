CREATE TYPE "public"."terms_kind" AS ENUM('teacher');--> statement-breakpoint
CREATE TABLE "teacher_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "terms_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "terms_kind" NOT NULL,
	"body" jsonb NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_versions_body_object" CHECK (jsonb_typeof("terms_versions"."body") = 'object')
);
--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "application_note" text;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "teacher_invites" ADD CONSTRAINT "teacher_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teacher_invites_invited_by_idx" ON "teacher_invites" USING btree ("invited_by","created_at" desc);--> statement-breakpoint
CREATE INDEX "terms_versions_kind_published_idx" ON "terms_versions" USING btree ("kind","published_at" desc);--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_texts_length" CHECK (coalesce(length("teacher_profiles"."application_note"), 0) <= 1000 and coalesce(length("teacher_profiles"."decision_reason"), 0) <= 1000);